/**
 * 0021-D2 W2 — حالات إعداد موعد التسليم في المتجر (بتتشغّل فعلًا في CI: pnpm --filter @zell/storefront cases).
 *
 * ⚠️ مفيش أي نداء حقيقي: zell_create_order هنا داتابيز مزيّفة بنفس قاعدة الـ idempotency (المفتاح + الهاش):
 *    نفس المفتاح ونفس الهاش = الرد الأصلي المحفوظ (replayed = true)، ونفس المفتاح وهاش مختلف = ZELL_IDEMPOTENCY_MISMATCH (45003).
 *    الهاش نفسه بيتحسب بالكود الحقيقي (canonical + sha256)، فالحالات بتثبت إن الهاش مابيتأثرش بالإعداد.
 */

import type { RpcResult } from '../data/rpc'
import { canonicalOrderJson, normalizeOrder } from './canonical'
import type { OrderRequest } from './contracts'
import {
  DELIVERY_NOTE_MAX,
  decideDelivery,
  deliveryNote,
  parseCheckoutDeliverySettings,
  showDeliveryChoice,
  type CheckoutDeliverySettings,
} from './deliverySettings'
import { ORDER_ERRORS, codeFromSqlError, orderFailure, statusFor } from './errors'
import { sha256Hex } from './hash'
import { createOrderArgs, placeOrder, type PlaceOrderDeps, type PlaceOrderIds } from './placeOrder'

export type DeliveryCaseFailure = { name: string; expected: string; actual: string }
export type DeliveryCaseReport = { passed: number; failures: DeliveryCaseFailure[] }

const failures: DeliveryCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const ON: CheckoutDeliverySettings = { customerChoiceEnabled: true, note: null }
const OFF: CheckoutDeliverySettings = { customerChoiceEnabled: false, note: 'هنتواصل معاك نحدد ميعاد التسليم' }
const DATE = { date: '2026-10-20', period: 'morning' as const, note: 'كلّمني قبلها بساعة' }

const BASE: OrderRequest = {
  customerName: 'أحمد علي',
  customerPhone: '01012345678',
  governorate: 'القاهرة',
  address: 'شارع التحرير ١٠ الدور الثالث',
  notes: null,
  items: [{ productId: 7, lengthCm: 150 }],
}
const WITH_DATE: OrderRequest = { ...BASE, preferredDelivery: DATE }

// ───────────────────────── داتابيز مزيّفة بقاعدة الـ idempotency ─────────────────────────

type Row = { key: string; hash: string; snapshot: Record<string, unknown>; preferred: unknown }

class FakeDb {
  rows: Row[] = []
  calls: Array<Record<string, unknown>> = []
  private seq = 0

  async createOrder(args: Record<string, unknown>): Promise<RpcResult<unknown>> {
    this.calls.push(args)
    const key = String(args['p_idempotency_key'])
    const hash = String(args['p_request_hash'])
    const existing = this.rows.find((row) => row.key === key)
    if (existing !== undefined) {
      if (existing.hash !== hash) return { ok: false, status: 400, sqlMessage: 'ZELL_IDEMPOTENCY_MISMATCH' }
      return { ok: true, data: { ...existing.snapshot, replayed: true } }
    }
    this.seq += 1
    const preferred = Object.prototype.hasOwnProperty.call(args, 'p_preferred_delivery') ? args['p_preferred_delivery'] : null
    const snapshot: Record<string, unknown> = {
      ok: true,
      order_number: 'FLM-T' + String(this.seq).padStart(5, '0'),
      subtotal_piastres: 45000,
      shipping_piastres: 5000,
      total_piastres: 50000,
      receipt_expires_at: '2026-10-27T00:00:00Z',
      preferred_delivery: preferred,
    }
    this.rows.push({ key, hash, snapshot, preferred })
    return { ok: true, data: { ...snapshot, replayed: false } }
  }
}

function idsFor(key: string): PlaceOrderIds {
  return { idempotencyKey: key, sessionHashHex: 'a'.repeat(64), receiptHashHex: 'b'.repeat(64) }
}

function depsFor(db: FakeDb, settings: () => CheckoutDeliverySettings | null, reads: { n: number }): PlaceOrderDeps {
  return {
    readDeliverySettings: async () => {
      reads.n += 1
      return settings()
    },
    createOrder: (args) => db.createOrder(args),
  }
}

function dataOf(result: RpcResult<unknown>): Record<string, unknown> | null {
  return result.ok && typeof result.data === 'object' && result.data !== null ? (result.data as Record<string, unknown>) : null
}

function withoutReplayed(data: Record<string, unknown> | null): Record<string, unknown> | null {
  if (data === null) return null
  const copy: Record<string, unknown> = { ...data }
  delete copy['replayed']
  return copy
}

async function hashOf(request: OrderRequest): Promise<string> {
  return sha256Hex(canonicalOrderJson(normalizeOrder(request)))
}

// ───────────────────────── الحالات ─────────────────────────

function parseCases(): void {
  check('P01 choice on, no note', parseCheckoutDeliverySettings({ customer_choice_enabled: true, note: null }), { customerChoiceEnabled: true, note: null })
  check('P02 choice off + note trimmed', parseCheckoutDeliverySettings({ customer_choice_enabled: false, note: '  هنكلمك  ' }), { customerChoiceEnabled: false, note: 'هنكلمك' })
  check('P03 empty note = no note', parseCheckoutDeliverySettings({ customer_choice_enabled: true, note: '   ' }), { customerChoiceEnabled: true, note: null })
  check('P04 missing note key = failed read', parseCheckoutDeliverySettings({ customer_choice_enabled: true }), null)
  check('P05 non-boolean choice = failed read', parseCheckoutDeliverySettings({ customer_choice_enabled: 'true', note: null }), null)
  check('P06 non-string note = failed read', parseCheckoutDeliverySettings({ customer_choice_enabled: true, note: 5 }), null)
  check('P07 note longer than 300 = failed read', parseCheckoutDeliverySettings({ customer_choice_enabled: true, note: 'x'.repeat(DELIVERY_NOTE_MAX + 1) }), null)
  check('P08 exactly 300 Arabic characters accepted', parseCheckoutDeliverySettings({ customer_choice_enabled: true, note: 'م'.repeat(DELIVERY_NOTE_MAX) })?.note?.length, DELIVERY_NOTE_MAX)
  check('P09 null / array / string = failed read', [parseCheckoutDeliverySettings(null), parseCheckoutDeliverySettings([]), parseCheckoutDeliverySettings('x')], [null, null, null])
}

function checkoutCases(): void {
  check('C01 field shown only when read and on', [showDeliveryChoice(ON), showDeliveryChoice(OFF), showDeliveryChoice(null)], [true, false, false])
  check('C02 note shown when present (on or off), hidden when read failed', [deliveryNote(ON), deliveryNote(OFF), deliveryNote(null), deliveryNote({ customerChoiceEnabled: true, note: 'سطر' })], [null, OFF.note, null, 'سطر'])
}

function decisionCases(): void {
  check('D01 no date + any setting = send nothing', [decideDelivery(null, ON), decideDelivery(null, OFF), decideDelivery(null, null)], [
    { kind: 'send', preferredDelivery: null, dropped: false },
    { kind: 'send', preferredDelivery: null, dropped: false },
    { kind: 'send', preferredDelivery: null, dropped: false },
  ])
  check('D02 date + on = send the date', decideDelivery(DATE, ON), { kind: 'send', preferredDelivery: DATE, dropped: false })
  check('D03 date + off = drop the date, still create', decideDelivery(DATE, OFF), { kind: 'send', preferredDelivery: null, dropped: true })
  check('D04 date + failed read = unavailable', decideDelivery(DATE, null), { kind: 'unavailable' })
}

function errorCases(): void {
  check('E01 DELIVERY_SETTINGS_UNAVAILABLE = 503 retryable', [statusFor('DELIVERY_SETTINGS_UNAVAILABLE'), ORDER_ERRORS.DELIVERY_SETTINGS_UNAVAILABLE.retryable], [503, true])
  check('E02 failure body (fixed message, no engine text)', orderFailure('DELIVERY_SETTINGS_UNAVAILABLE'), {
    ok: false,
    code: 'DELIVERY_SETTINGS_UNAVAILABLE',
    message: 'حصلت مشكلة مؤقتة، حاول تاني.',
    retryable: true,
  })
  check('E03 45003 from the engine still maps to IDEMPOTENCY_MISMATCH', codeFromSqlError('ZELL_IDEMPOTENCY_MISMATCH'), 'IDEMPOTENCY_MISMATCH')
}

async function routeCases(): Promise<void> {
  const hashNoDate = await hashOf(BASE)
  const hashWithDate = await hashOf(WITH_DATE)
  check('H01 the date is part of the hash (d1)', hashNoDate !== hashWithDate, true)

  // R01–R02: شغّال وطلب بموعد ← المالك يقفل ← نفس المفتاح ونفس الطلب = الرد الأصلي (بالموعد)
  {
    const db = new FakeDb()
    const reads = { n: 0 }
    let current: CheckoutDeliverySettings | null = ON
    const deps = depsFor(db, () => current, reads)
    const first = await placeOrder(WITH_DATE, idsFor('key-on-then-off-0001'), deps)
    const firstData = first.kind === 'called' ? dataOf(first.result) : null
    check('R01 on + date: created with the date, hash = customer request', [
      first.kind,
      first.kind === 'called' ? first.requestHash === hashWithDate : null,
      db.calls[0]?.['p_preferred_delivery'],
      firstData?.['replayed'],
    ], ['called', true, DATE, false])
    current = OFF
    const second = await placeOrder(WITH_DATE, idsFor('key-on-then-off-0001'), deps)
    const secondData = second.kind === 'called' ? dataOf(second.result) : null
    check('R02 owner closes, same key + same request: original reply with its content (the date), no new order, no 45003', [
      second.kind,
      second.kind === 'called' ? second.result.ok : null,
      secondData?.['replayed'],
      JSON.stringify(withoutReplayed(secondData)) === JSON.stringify(withoutReplayed(firstData)),
      secondData?.['preferred_delivery'],
      db.rows.length,
      second.kind === 'called' ? second.requestHash === hashWithDate : null,
      Object.prototype.hasOwnProperty.call(db.calls[1] ?? {}, 'p_preferred_delivery'),
    ], ['called', true, true, true, DATE, 1, true, false])
  }

  // R03–R04: مقفول وطلب بموعد (اتعمل من غيره) ← المالك يفتح ← نفس المفتاح ونفس الطلب = الرد الأصلي (من غير موعد)
  {
    const db = new FakeDb()
    const reads = { n: 0 }
    let current: CheckoutDeliverySettings | null = OFF
    const deps = depsFor(db, () => current, reads)
    const first = await placeOrder(WITH_DATE, idsFor('key-off-then-on-0001'), deps)
    const firstData = first.kind === 'called' ? dataOf(first.result) : null
    check('R03 off + date: created without the date, hash still = customer request with the date', [
      first.kind,
      first.kind === 'called' ? [first.requestHash === hashWithDate, first.requestHash === hashNoDate, first.preferredSent, first.preferredDropped] : null,
      Object.prototype.hasOwnProperty.call(db.calls[0] ?? {}, 'p_preferred_delivery'),
      firstData?.['preferred_delivery'],
    ], ['called', [true, false, false, true], false, null])
    current = ON
    const second = await placeOrder(WITH_DATE, idsFor('key-off-then-on-0001'), deps)
    const secondData = second.kind === 'called' ? dataOf(second.result) : null
    check('R04 owner opens, same key + same request: original reply with its content (no date), no new order, no 45003', [
      second.kind === 'called' ? second.result.ok : null,
      secondData?.['replayed'],
      JSON.stringify(withoutReplayed(secondData)) === JSON.stringify(withoutReplayed(firstData)),
      secondData?.['preferred_delivery'],
      db.rows.length,
      db.calls[1]?.['p_preferred_delivery'],
    ], [true, true, true, null, 1, DATE])
  }

  // R05–R06: نفس المفتاح بطلب مختلف (موعد اتشال أو اتضاف) = 45003
  {
    const db = new FakeDb()
    const deps = depsFor(db, () => ON, { n: 0 })
    await placeOrder(WITH_DATE, idsFor('key-date-removed-01'), deps)
    const removed = await placeOrder(BASE, idsFor('key-date-removed-01'), deps)
    check('R05 same key, date removed -> 45003 (IDEMPOTENCY_MISMATCH), no new order', [
      removed.kind === 'called' && !removed.result.ok ? codeFromSqlError(removed.result.sqlMessage) : 'none',
      db.rows.length,
    ], ['IDEMPOTENCY_MISMATCH', 1])
    const db2 = new FakeDb()
    const deps2 = depsFor(db2, () => ON, { n: 0 })
    await placeOrder(BASE, idsFor('key-date-added-0001'), deps2)
    const added = await placeOrder(WITH_DATE, idsFor('key-date-added-0001'), deps2)
    check('R06 same key, date added -> 45003 (IDEMPOTENCY_MISMATCH), no new order', [
      added.kind === 'called' && !added.result.ok ? codeFromSqlError(added.result.sqlMessage) : 'none',
      db2.rows.length,
    ], ['IDEMPOTENCY_MISMATCH', 1])
  }

  // R07: القراية فشلت + موعد = 503 من غير نداء zell_create_order
  {
    const db = new FakeDb()
    const reads = { n: 0 }
    const outcome = await placeOrder(WITH_DATE, idsFor('key-read-failed-001'), depsFor(db, () => null, reads))
    check('R07 failed read + date -> DELIVERY_SETTINGS_UNAVAILABLE, zell_create_order not called', [
      outcome.kind === 'failure' ? outcome.code : outcome.kind,
      db.calls.length,
      reads.n,
    ], ['DELIVERY_SETTINGS_UNAVAILABLE', 0, 1])
  }

  // R08: القراية فشلت + من غير موعد = الطلب بيتعمل (ومفيش قراية أصلًا)
  {
    const db = new FakeDb()
    const reads = { n: 0 }
    const outcome = await placeOrder(BASE, idsFor('key-no-date-failed1'), depsFor(db, () => null, reads))
    check('R08 no date + failed read -> order created, no settings read, hash = today', [
      outcome.kind,
      outcome.kind === 'called' ? outcome.result.ok : null,
      outcome.kind === 'called' ? outcome.requestHash === hashNoDate : null,
      reads.n,
      db.rows.length,
    ], ['called', true, true, 0, 1])
  }

  // R09: «حاول تاني» بعد 503 بنفس المفتاح ونفس البيانات = طلب واحد بالموعد
  {
    const db = new FakeDb()
    let current: CheckoutDeliverySettings | null = null
    const deps = depsFor(db, () => current, { n: 0 })
    const first = await placeOrder(WITH_DATE, idsFor('key-retry-after-503'), deps)
    current = ON
    const second = await placeOrder(WITH_DATE, idsFor('key-retry-after-503'), deps)
    const third = await placeOrder(WITH_DATE, idsFor('key-retry-after-503'), deps)
    check('R09 retry after 503 with the same key + data: one order with the date, then a replay', [
      first.kind === 'failure' ? first.code : first.kind,
      second.kind === 'called' ? dataOf(second.result)?.['replayed'] : null,
      third.kind === 'called' ? dataOf(third.result)?.['replayed'] : null,
      db.rows.length,
      db.rows[0]?.preferred,
    ], ['DELIVERY_SETTINGS_UNAVAILABLE', false, true, 1, DATE])
  }

  // R10: من غير موعد = نفس النداء القديم بالحرف (نفس المفاتيح)
  {
    const db = new FakeDb()
    await placeOrder(BASE, idsFor('key-legacy-shape-01'), depsFor(db, () => ON, { n: 0 }))
    check('R10 no date: exactly the old argument keys', Object.keys(db.calls[0] ?? {}), [
      'p_items',
      'p_customer_name',
      'p_customer_phone',
      'p_governorate',
      'p_address',
      'p_notes',
      'p_idempotency_key',
      'p_request_hash',
      'p_checkout_session_hash',
      'p_receipt_token_hash',
    ])
  }

  // R11: الشغّال + موعد = نفس نداء 0021-D بالحرف
  {
    const db = new FakeDb()
    await placeOrder(WITH_DATE, idsFor('key-d-shape-000001'), depsFor(db, () => ON, { n: 0 }))
    const expected = createOrderArgs(normalizeOrder(WITH_DATE), idsFor('key-d-shape-000001'), hashWithDate)
    check('R11 on + date: the call = the 0021-D call', JSON.stringify(db.calls[0]), JSON.stringify(expected))
  }

  // R12: الطلب المطبّع ماتلمسش (نسخة جديدة للداتابيز)
  {
    const request: OrderRequest = { ...WITH_DATE, items: [{ productId: 7, lengthCm: 150 }] }
    const before = JSON.stringify(request)
    await placeOrder(request, idsFor('key-no-mutation-001'), depsFor(new FakeDb(), () => OFF, { n: 0 }))
    check('R12 the customer request is not mutated when the date is dropped', JSON.stringify(request), before)
  }

  // R13: zell_create_order رمت = INTERNAL
  {
    const outcome = await placeOrder(BASE, idsFor('key-rpc-threw-00001'), {
      readDeliverySettings: async () => ON,
      createOrder: async () => {
        throw new Error('boom')
      },
    })
    check('R13 rpc threw -> INTERNAL', outcome.kind === 'failure' ? [outcome.code, outcome.reason] : outcome.kind, ['INTERNAL', 'rpc_threw'])
  }
}

export async function runDeliverySettingsCases(): Promise<DeliveryCaseReport> {
  parseCases()
  checkoutCases()
  decisionCases()
  errorCases()
  await routeCases()
  return { passed, failures }
}
