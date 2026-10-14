/**
 * EXPRESS-SHIPPING W2 — حالات الشحن السريع في المتجر (بتتشغّل فعلًا في CI: pnpm --filter @zell/storefront cases، suite shipping).
 *
 * ⚠️ مفيش أي نداء حقيقي: zell_create_order هنا داتابيز مزيّفة بنفس قاعدة الـ idempotency (المفتاح + الهاش) ونفس قاعدة
 *    السريع (متاح = سعره الكامل، مش متاح = ZELL_SHIPPING_EXPRESS_UNAVAILABLE قبل أي إدخال، والـ replay = اللقطة المحفوظة).
 *    الهاش بيتحسب بالكود الحقيقي (canonical + sha256). المقارنة الحقيقية core ↔ Postgres في CI: backend/db/ci/0021ex_core_parity.mjs.
 */

import {
  expressOffer,
  parseShippingMethodField,
  parseShippingOptions,
  parseShippingSnapshot,
  shippingDaysLine,
  shippingForMethod,
  shippingSnapshotLine,
  standardShippingDays,
  type ShippingOptions,
  type ShippingQuoteInput,
} from '@zell/core'
import type { RpcResult } from '../data/rpc'
import { canonicalOrderJson, normalizeOrder } from './canonical'
import type { OrderRequest } from './contracts'
import { ORDER_ERRORS, codeFromSqlError, orderFailure, statusFor } from './errors'
import { sha256Hex } from './hash'
import { createOrderArgs, placeOrder, type PlaceOrderDeps, type PlaceOrderIds } from './placeOrder'
import { parseDraftShippingMethod, shippingChoiceView, shippingPayloadField, shippingSummaryLabel } from './shippingChoice'

export type ShippingCaseFailure = { name: string; expected: string; actual: string }
export type ShippingCaseReport = { passed: number; failures: ShippingCaseFailure[] }

const failures: ShippingCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

// نفس إعداد CI (0021ex_flows.sql §C): السريع شغّال · القاهرة 12000 مدة 1–2 وعادي 3–5 · الجيزة سريع مقفول · أسوان سريع متاح.
const RAW = {
  express_enabled: true,
  governorates: {
    القاهرة: { standard_days_min: 3, standard_days_max: 5, express_enabled: true, express_price_piastres: 12000, express_days_min: 1, express_days_max: 2 },
    الجيزة: { standard_days_min: null, standard_days_max: null, express_enabled: false, express_price_piastres: 9000, express_days_min: null, express_days_max: null },
    أسوان: { standard_days_min: null, standard_days_max: null, express_enabled: true, express_price_piastres: 7000, express_days_min: 1, express_days_max: 2 },
  },
}
const OPTIONS = parseShippingOptions(RAW) as ShippingOptions
const RATES: Record<string, number> = { القاهرة: 5000, الجيزة: 6000 }

function quote(governorate: string, subtotalPiastres: number): ShippingQuoteInput {
  return { governorate, subtotalPiastres, rates: RATES, defaultPiastres: 0, freeThresholdPiastres: 500000 }
}

function withGov(cfg: Record<string, unknown>, enabled = true): ShippingOptions {
  return parseShippingOptions({ express_enabled: enabled, governorates: { القاهرة: cfg } }) as ShippingOptions
}

const VALID = { express_enabled: true, express_price_piastres: 12000, express_days_min: 1, express_days_max: 2 }

const BASE: OrderRequest = {
  customerName: 'أحمد علي',
  customerPhone: '01012345678',
  governorate: 'القاهرة',
  address: 'شارع التحرير ١٠ الدور الثالث',
  notes: null,
  items: [{ productId: 1, lengthCm: 300 }],
}
const EXPRESS: OrderRequest = { ...BASE, shippingMethod: 'express' }

// ───────────────────────── داتابيز مزيّفة: idempotency + قاعدة السريع ─────────────────────────

type Row = { key: string; hash: string; snapshot: Record<string, unknown> }

class FakeDb {
  rows: Row[] = []
  calls: Array<Record<string, unknown>> = []
  expressAvailable = true
  expressPrice = 12000
  private seq = 0

  async createOrder(args: Record<string, unknown>): Promise<RpcResult<unknown>> {
    this.calls.push(args)
    const key = String(args['p_idempotency_key'])
    const hash = String(args['p_request_hash'])
    // الـ replay قبل أي فحص للطريقة أو الإعداد — زي (د) في zell_create_order
    const existing = this.rows.find((row) => row.key === key)
    if (existing !== undefined) {
      if (existing.hash !== hash) return { ok: false, status: 400, sqlMessage: 'ZELL_IDEMPOTENCY_MISMATCH' }
      return { ok: true, data: { ...existing.snapshot, replayed: true } }
    }
    const method = Object.prototype.hasOwnProperty.call(args, 'p_shipping_method') ? args['p_shipping_method'] : 'standard'
    if (method !== 'standard' && method !== 'express') return { ok: false, status: 400, sqlMessage: 'ZELL_SHIPPING_METHOD_INVALID' }
    if (method === 'express' && !this.expressAvailable) return { ok: false, status: 400, sqlMessage: 'ZELL_SHIPPING_EXPRESS_UNAVAILABLE' }
    this.seq += 1
    const shipping = method === 'express' ? this.expressPrice : 5000
    const snapshot: Record<string, unknown> = {
      ok: true,
      order_number: 'FLM-S' + String(this.seq).padStart(5, '0'),
      subtotal_piastres: 90000,
      shipping_piastres: shipping,
      total_piastres: 90000 + shipping,
      receipt_expires_at: '2026-10-27T00:00:00Z',
    }
    this.rows.push({ key, hash, snapshot })
    return { ok: true, data: { ...snapshot, replayed: false } }
  }
}

function idsFor(key: string): PlaceOrderIds {
  return { idempotencyKey: key, sessionHashHex: 'a'.repeat(64), receiptHashHex: 'b'.repeat(64) }
}

function depsFor(db: FakeDb): PlaceOrderDeps {
  return {
    readDeliverySettings: async () => null,
    createOrder: (args) => db.createOrder(args),
  }
}

function dataOf(outcome: Awaited<ReturnType<typeof placeOrder>>): Record<string, unknown> | null {
  if (outcome.kind !== 'called' || !outcome.result.ok) return null
  const data = outcome.result.data
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

function sqlOf(outcome: Awaited<ReturnType<typeof placeOrder>>): string | null {
  return outcome.kind === 'called' && !outcome.result.ok ? outcome.result.sqlMessage : null
}

// ───────────────────────── الحالات ─────────────────────────

function optionCases(): void {
  check('O01 parse checkout read', OPTIONS.expressEnabled, true)
  check('O02 bad shapes = failed read (null)', [parseShippingOptions(null), parseShippingOptions([]), parseShippingOptions({ express_enabled: 'true', governorates: {} }), parseShippingOptions({ express_enabled: true, governorates: [] }), parseShippingOptions({ express_enabled: true })], [null, null, null, null, null])
  // نفس أرقام سيناريوهات الداتابيز (0021ex_flows.sql F30–F41)
  check('O03 Cairo express offer = 12000, 1–2 days', expressOffer(OPTIONS, 'القاهرة'), { pricePiastres: 12000, days: { min: 1, max: 2 } })
  check('O04 Giza express off -> no offer', expressOffer(OPTIONS, 'الجيزة'), null)
  check('O05 unknown governorate -> no offer', expressOffer(OPTIONS, 'الإسكندرية'), null)
  check('O06 global switch off -> no offer anywhere', expressOffer(parseShippingOptions({ ...RAW, express_enabled: false }), 'القاهرة'), null)
  check('O07 failed read -> no offer, no standard days', [expressOffer(null, 'القاهرة'), standardShippingDays(null, 'القاهرة')], [null, null])
  check('O08 malformed express (string price · 0 · fraction · > 100,000,000 · days > 60 · min > max · missing days · not true) -> no offer', [
    expressOffer(withGov({ ...VALID, express_price_piastres: '12000' }), 'القاهرة'),
    expressOffer(withGov({ ...VALID, express_price_piastres: 0 }), 'القاهرة'),
    expressOffer(withGov({ ...VALID, express_price_piastres: 1.5 }), 'القاهرة'),
    expressOffer(withGov({ ...VALID, express_price_piastres: 100000001 }), 'القاهرة'),
    expressOffer(withGov({ ...VALID, express_days_max: 70 }), 'القاهرة'),
    expressOffer(withGov({ ...VALID, express_days_min: 3 }), 'القاهرة'),
    expressOffer(withGov({ express_enabled: true, express_price_piastres: 12000 }), 'القاهرة'),
    expressOffer(withGov({ ...VALID, express_enabled: 'true' }), 'القاهرة'),
  ], [null, null, null, null, null, null, null, null])
  check('O09 boundaries accepted (price 1 and 100,000,000 · days 0..60)', [
    expressOffer(withGov({ ...VALID, express_price_piastres: 1, express_days_min: 0, express_days_max: 0 }), 'القاهرة'),
    expressOffer(withGov({ ...VALID, express_price_piastres: 100000000, express_days_min: 60, express_days_max: 60 }), 'القاهرة'),
  ], [{ pricePiastres: 1, days: { min: 0, max: 0 } }, { pricePiastres: 100000000, days: { min: 60, max: 60 } }])
  check('O10 standard days: valid 3–5 · malformed = none (never blocks)', [
    standardShippingDays(OPTIONS, 'القاهرة'),
    standardShippingDays(OPTIONS, 'الجيزة'),
    standardShippingDays(withGov({ standard_days_min: 9, standard_days_max: 3 }), 'القاهرة'),
    standardShippingDays(withGov({ standard_days_min: 'x', standard_days_max: 2 }), 'القاهرة'),
  ], [{ min: 3, max: 5 }, null, null, null])
  check('O11 days line from actual shipping (no arrival date)', [shippingDaysLine({ min: 3, max: 5 }), shippingDaysLine({ min: 2, max: 2 })], ['خلال 3–5 يوم من الشحن', 'خلال 2 يوم من الشحن'])
}

function priceCases(): void {
  check('S01 express = full price, no free shipping even above the threshold (600000)', shippingForMethod('express', quote('القاهرة', 600000), OPTIONS), 12000)
  check('S02 standard above the threshold = 0 (old rule)', shippingForMethod('standard', quote('القاهرة', 600000), OPTIONS), 0)
  check('S03 standard below the threshold = governorate rate', shippingForMethod('standard', quote('الجيزة', 90000), OPTIONS), 6000)
  check('S04 express unavailable -> no price', shippingForMethod('express', quote('الجيزة', 90000), OPTIONS), null)
}

function choiceCases(): void {
  const cairo = shippingChoiceView('express', quote('القاهرة', 90000), OPTIONS)
  check('C01 Cairo + express chosen -> express 12000', [cairo.method, cairo.shippingPiastres, cairo.stranded, shippingSummaryLabel(cairo)], ['express', 12000, false, 'الشحن السريع'])
  const std = shippingChoiceView('standard', quote('القاهرة', 90000), OPTIONS)
  check('C02 Cairo standard -> 5000 with standard days, label «الشحن العادي»', [std.method, std.shippingPiastres, std.standardDays, shippingSummaryLabel(std)], ['standard', 5000, { min: 3, max: 5 }, 'الشحن العادي'])
  const moved = shippingChoiceView('express', quote('الجيزة', 90000), OPTIONS)
  check('C03 governorate changed to one without express -> standard price shown, stranded (no silent switch)', [moved.method, moved.stranded, moved.offer, shippingSummaryLabel(moved)], ['standard', true, null, 'الشحن'])
  const failed = shippingChoiceView('express', quote('القاهرة', 90000), null)
  check('C04 failed settings read -> choice hidden, standard, not blocked', [failed.method, failed.stranded, failed.offer, failed.shippingPiastres], ['standard', false, null, 5000])
  const none = shippingChoiceView('express', null, OPTIONS)
  check('C05 no governorate yet -> nothing to show', [none.method, none.stranded, none.shippingPiastres], ['standard', false, null])
  check('C06 payload field only for express', [shippingPayloadField('express'), shippingPayloadField('standard')], [{ shippingMethod: 'express' }, {}])
  check('C07 draft keeps the choice only: missing / express ok · anything else = draft ignored', [
    parseDraftShippingMethod(undefined), parseDraftShippingMethod('express'), parseDraftShippingMethod('standard'), parseDraftShippingMethod(12000),
  ], [{ ok: true }, { ok: true, method: 'express' }, { ok: false }, { ok: false }])
  check('C08 body field: missing / null = standard · express · anything else rejected', [
    parseShippingMethodField(undefined), parseShippingMethodField(null), parseShippingMethodField('express'),
    parseShippingMethodField('standard'), parseShippingMethodField('EXPRESS'), parseShippingMethodField(''), parseShippingMethodField(true),
  ], [{ ok: true, method: 'standard' }, { ok: true, method: 'standard' }, { ok: true, method: 'express' }, { ok: false }, { ok: false }, { ok: false }, { ok: false }])
  check('C09 order snapshot line: express with days · standard without · old order = none', [
    shippingSnapshotLine(parseShippingSnapshot('express', 1, 2) ?? { method: 'standard', days: null }),
    shippingSnapshotLine(parseShippingSnapshot('standard', null, null) ?? { method: 'express', days: null }),
    parseShippingSnapshot(null, null, null),
  ], ['شحن سريع · خلال 1–2 يوم من الشحن', 'شحن عادي', null])
}

async function hashCases(): Promise<void> {
  const oldCanonical = JSON.stringify([BASE.customerName, BASE.customerPhone, BASE.governorate, BASE.address, null, [[1, 300]]])
  check('H01 standard keeps the old canonical (and hash) exactly', canonicalOrderJson(normalizeOrder(BASE)), oldCanonical)
  check('H02 express adds [s1, express] at the end only', canonicalOrderJson(normalizeOrder(EXPRESS)), oldCanonical.slice(0, -1) + ',["s1","express"]]')
  check('H03 standard hash = sha256(old canonical)', await sha256Hex(canonicalOrderJson(normalizeOrder(BASE))), await sha256Hex(oldCanonical))
  const ids = idsFor('k-args-000000000001')
  check('H04 RPC args: p_shipping_method only for express', [
    Object.prototype.hasOwnProperty.call(createOrderArgs(normalizeOrder(BASE), ids, 'h'), 'p_shipping_method'),
    createOrderArgs(normalizeOrder(EXPRESS), ids, 'h')['p_shipping_method'],
  ], [false, 'express'])
}

async function flowCases(): Promise<void> {
  // retry بعد تغيير السعر ثم تعطيل السريع = الرد الأصلي
  const db = new FakeDb()
  const first = await placeOrder(EXPRESS, idsFor('k-express-0000000001'), depsFor(db))
  db.expressPrice = 15000
  const afterPrice = await placeOrder(EXPRESS, idsFor('k-express-0000000001'), depsFor(db))
  db.expressAvailable = false
  const afterOff = await placeOrder(EXPRESS, idsFor('k-express-0000000001'), depsFor(db))
  check('F01 express order: full price 12000', dataOf(first)?.['shipping_piastres'], 12000)
  check('F02 retry after a price change = original response (replayed, 12000)', [dataOf(afterPrice)?.['replayed'], dataOf(afterPrice)?.['shipping_piastres'], dataOf(afterPrice)?.['order_number']], [true, 12000, dataOf(first)?.['order_number']])
  check('F03 retry after express is switched off = original response', [dataOf(afterOff)?.['replayed'], dataOf(afterOff)?.['total_piastres']], [true, 102000])
  // نفس المفتاح بطلب مختلف (عادي بدل سريع) = 45003
  const mismatch = await placeOrder(BASE, idsFor('k-express-0000000001'), depsFor(db))
  check('F04 same key, different request (standard) -> IDEMPOTENCY_MISMATCH', mismatch.kind === 'called' ? codeFromSqlError(sqlOf(mismatch) ?? '') : mismatch.code, 'IDEMPOTENCY_MISMATCH')
  // السريع اتقفل قبل الطلب = رفض واضح، مفيش تحويل لعادي ومفيش طلب
  const closed = await placeOrder(EXPRESS, idsFor('k-express-0000000002'), depsFor(db))
  const code = codeFromSqlError(sqlOf(closed) ?? '')
  check('F05 express closed before the order -> SHIPPING_EXPRESS_UNAVAILABLE (409), nothing created, call carried express', [code, statusFor(code), db.rows.length, db.calls[db.calls.length - 1]?.['p_shipping_method']], ['SHIPPING_EXPRESS_UNAVAILABLE', 409, 1, 'express'])
  check('F06 customer message for closed express', orderFailure('SHIPPING_EXPRESS_UNAVAILABLE').message, ORDER_ERRORS.SHIPPING_EXPRESS_UNAVAILABLE.message)
  check('F07 invalid method from the database maps to SHIPPING_METHOD_INVALID (400)', [codeFromSqlError('ZELL_SHIPPING_METHOD_INVALID'), statusFor('SHIPPING_METHOD_INVALID')], ['SHIPPING_METHOD_INVALID', 400])
  // العادي = نفس النداء القديم بالحرف (من غير p_shipping_method)
  const db2 = new FakeDb()
  const standard = await placeOrder(BASE, idsFor('k-standard-000000001'), depsFor(db2))
  check('F08 standard order: old call (no p_shipping_method), 5000', [Object.prototype.hasOwnProperty.call(db2.calls[0] ?? {}, 'p_shipping_method'), dataOf(standard)?.['shipping_piastres']], [false, 5000])
}

export async function runShippingCases(): Promise<ShippingCaseReport> {
  optionCases()
  priceCases()
  choiceCases()
  await hashCases()
  await flowCases()
  return { passed, failures }
}
