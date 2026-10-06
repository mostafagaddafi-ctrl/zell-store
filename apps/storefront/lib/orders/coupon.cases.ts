/**
 * حالات اختبار PR3 (كوبون المتجر) — من غير مكتبة اختبار (الريبو مافيهوش test runner).
 * runStorefrontCouponCases() بترجّع الحالات اللي فشلت بس (فاضية = كله تمام). الـCI بيعمل typecheck
 * للملف ده، ومحدش بيستورده فمابيدخلش في الـbundle.
 *
 * ⚠️ مفيش أي نداء حقيقي هنا: الـrpc في حالات المعاينة مزيّف، ومفيش zell_create_order خالص.
 */

import { canonicalOrderJson, normalizeOrder } from './canonical'
import type { CreateOrderResult, OrderErrorCode, OrderRequest } from './contracts'
import { DISCOUNT_SIGN, discountLabel, discountLine, parseCouponCodeField } from './coupon'
import { handleCouponPreview, parsePreviewBody, type PreviewRpcResult } from './couponPreview'
import { codeFromSqlError, orderFailure, previewCodeFromSqlError, statusFor } from './errors'
import { isCreateOrderResult, orderSuccessBody } from './result'

export type StorefrontCouponCaseFailure = { name: string; expected: string; actual: string }

// ───────────────────────── canonical ─────────────────────────

const BASE_ORDER: OrderRequest = {
  customerName: ' أحمد علي ',
  customerPhone: '01012345678',
  governorate: 'القاهرة',
  address: 'شارع التحرير ١٠ الدور الثالث',
  notes: null,
  items: [
    { productId: 7, lengthCm: 150, widthCm: 60 },
    { productId: 3, quantity: 2 },
    { productId: 7, lengthCm: 100 },
  ],
}

/** الصيغة القديمة بالحرف (قبل 0019) — لو اتغيّرت، مفاتيح الطلبات العادية في sessionStorage تتغير. */
const OLD_BASE = '["أحمد علي","01012345678","القاهرة","شارع التحرير ١٠ الدور الثالث",null,[[3,"q",2],[7,100],[7,150,60]]'
const OLD_CANONICAL = OLD_BASE + ']'
const OLD_V2_INSTALL = OLD_BASE + ',["v2","مدينة نصر",1]]'
const OLD_V2_AREA = OLD_BASE + ',["v2","مدينة نصر",0]]'

/** [الاسم، الطلب، canonical المتوقع] */
export const CANONICAL_CASES: ReadonlyArray<readonly [string, OrderRequest, string]> = [
  ['no coupon = old canonical', BASE_ORDER, OLD_CANONICAL],
  ['empty coupon = old canonical', { ...BASE_ORDER, couponCode: '' }, OLD_CANONICAL],
  ['spaces-only coupon = old canonical', { ...BASE_ORDER, couponCode: '   ' }, OLD_CANONICAL],
  ['area + installation, no coupon = old v2', { ...BASE_ORDER, area: ' مدينة نصر ', installation: true }, OLD_V2_INSTALL],
  ['area only, no coupon = old v2', { ...BASE_ORDER, area: 'مدينة نصر' }, OLD_V2_AREA],
  ['coupon only → c1 last', { ...BASE_ORDER, couponCode: 'ZELL10' }, OLD_BASE + ',["c1","ZELL10"]]'],
  ['lowercase + edge spaces → same c1', { ...BASE_ORDER, couponCode: '  zell10 ' }, OLD_BASE + ',["c1","ZELL10"]]'],
  [
    'area + installation + coupon → v2 then c1',
    { ...BASE_ORDER, area: 'مدينة نصر', installation: true, couponCode: 'zell10' },
    OLD_BASE + ',["v2","مدينة نصر",1],["c1","ZELL10"]]',
  ],
  [
    'area only + coupon → v2 then c1',
    { ...BASE_ORDER, area: 'مدينة نصر', couponCode: 'Half-50' },
    OLD_BASE + ',["v2","مدينة نصر",0],["c1","HALF-50"]]',
  ],
]

// ───────────────────────── body parsers ─────────────────────────

/** couponCode في body الطلب: [الاسم، الخام، المتوقع: الكود · 'none' · 'invalid'] */
export const ORDER_FIELD_CASES: ReadonlyArray<readonly [string, unknown, string]> = [
  ['missing', undefined, 'none'],
  ['null', null, 'none'],
  ['empty', '', 'none'],
  ['spaces only', '   ', 'none'],
  ['valid', 'ZELL10', 'ZELL10'],
  ['lowercase + spaces', '  zell-10_a ', 'ZELL-10_A'],
  ['arabic', 'خصم10', 'invalid'],
  ['inner space', 'ZELL 10', 'invalid'],
  ['too short', 'AB', 'invalid'],
  ['too long', 'A'.repeat(33), 'invalid'],
  ['number', 10, 'invalid'],
  ['boolean', true, 'invalid'],
  ['object', { code: 'ZELL10' }, 'invalid'],
]

/** body المعاينة: [الاسم، الـpayload بعد JSON.parse، المتوقع: الكود أو كود الخطأ] */
export const PREVIEW_BODY_CASES: ReadonlyArray<readonly [string, unknown, string]> = [
  ['valid', { code: 'ZELL10' }, 'ZELL10'],
  ['lowercase + spaces', { code: '  zell10 ' }, 'ZELL10'],
  ['empty code', { code: '' }, 'COUPON_INVALID'],
  ['spaces code', { code: '   ' }, 'COUPON_INVALID'],
  ['arabic', { code: 'خصم10' }, 'COUPON_INVALID'],
  ['too long', { code: 'A'.repeat(33) }, 'COUPON_INVALID'],
  ['number code', { code: 10 }, 'COUPON_INVALID'],
  ['missing code', {}, 'BAD_JSON'],
  ['extra key', { code: 'ZELL10', discount: 100 }, 'BAD_JSON'],
  ['array', [{ code: 'ZELL10' }], 'BAD_JSON'],
  ['null', null, 'BAD_JSON'],
  ['string', 'ZELL10', 'BAD_JSON'],
]

// ───────────────────────── errors ─────────────────────────

/** رسالة SQL الخام من 0019 → [كود العقد، الحالة] */
export const SQL_ERROR_CASES: ReadonlyArray<readonly [string, OrderErrorCode, number]> = [
  ['ZELL_COUPON_INVALID', 'COUPON_INVALID', 400],
  ['ZELL_COUPON_EXPIRED', 'COUPON_EXPIRED', 409],
  ['ZELL_COUPON_EXHAUSTED', 'COUPON_EXHAUSTED', 409],
  ['ZELL_COUPON_MIN_SUBTOTAL', 'COUPON_MIN_SUBTOTAL', 409],
  ['ZELL_COUPON_PHONE_LIMIT', 'COUPON_PHONE_LIMIT', 409],
  ['ZELL_COUPON_NOT_APPLICABLE', 'COUPON_NOT_APPLICABLE', 409],
  ['ZELL_COUPONS_DISABLED', 'COUPONS_DISABLED', 409],
  ['ZELL_ORDER_CANCELLED_FINAL', 'INTERNAL', 500],
  ['permission denied for function zell_create_order', 'INTERNAL', 500],
]

/** نفس الرسايل في المعاينة: المعاينة بترجّع ٤ أكواد بس، والباقي INTERNAL. */
export const PREVIEW_SQL_CASES: ReadonlyArray<readonly [string, string]> = [
  ['ZELL_COUPONS_DISABLED', 'COUPONS_DISABLED'],
  ['ZELL_COUPON_INVALID', 'COUPON_INVALID'],
  ['ZELL_COUPON_EXPIRED', 'COUPON_EXPIRED'],
  ['ZELL_COUPON_EXHAUSTED', 'COUPON_EXHAUSTED'],
  ['ZELL_COUPON_PHONE_LIMIT', 'INTERNAL'],
  ['ZELL_COUPON_MIN_SUBTOTAL', 'INTERNAL'],
  ['ZELL_ITEM_UNAVAILABLE', 'INTERNAL'],
  ['ZELL_ORDER_CANCELLED_FINAL', 'INTERNAL'],
  ['syntax error at or near', 'INTERNAL'],
]

// ───────────────────────── result / replay ─────────────────────────

const RESULT_BASE = {
  ok: true,
  replayed: false,
  order_number: 'FLM-TEST01',
  subtotal_piastres: 60000,
  shipping_piastres: 5000,
  total_piastres: 59000,
  shipping_area: null,
  installation_requested: false,
  installation_piastres: 0,
  installation_travel_piastres: 0,
  discount_piastres: 6000,
  coupon_code: 'ZELL10',
  receipt_expires_at: '2030-01-01T00:00:00Z',
}

/** [الاسم، النتيجة الخام، المتوقع: 'code:discount:total:replayed' أو 'rejected'] */
export const RESULT_CASES: ReadonlyArray<readonly [string, unknown, string]> = [
  ['new order with coupon', RESULT_BASE, 'ZELL10:6000:59000:false'],
  // الـreplay بيرجّع اللقطة كما هي: 10% من 61725 = 6173 لو اتحسب تاني — لكن المسجّل 6000 هو اللي يرجع
  ['replay keeps snapshot', { ...RESULT_BASE, replayed: true, subtotal_piastres: 61725 }, 'ZELL10:6000:59000:true'],
  ['no coupon (0019 shape)', { ...RESULT_BASE, discount_piastres: 0, coupon_code: null, total_piastres: 65000 }, 'null:0:65000:false'],
  [
    'legacy shape (no coupon keys)',
    {
      ok: true,
      replayed: true,
      order_number: 'FLM-TEST02',
      subtotal_piastres: 60000,
      shipping_piastres: 5000,
      total_piastres: 65000,
      receipt_expires_at: '2030-01-01T00:00:00Z',
    },
    'null:0:65000:true',
  ],
  ['discount as string', { ...RESULT_BASE, discount_piastres: '6000' }, 'rejected'],
  ['discount negative', { ...RESULT_BASE, discount_piastres: -1 }, 'rejected'],
  ['discount fraction', { ...RESULT_BASE, discount_piastres: 0.5 }, 'rejected'],
  ['coupon code number', { ...RESULT_BASE, coupon_code: 10 }, 'rejected'],
  ['missing order number', { ...RESULT_BASE, order_number: undefined }, 'rejected'],
]

// ───────────────────────── receipt / telegram line ─────────────────────────

/** [الاسم، coupon_code، discount_piastres، المتوقع: 'CODE:piastres' أو 'none'] */
export const DISCOUNT_LINE_CASES: ReadonlyArray<readonly [string, unknown, unknown, string]> = [
  ['with coupon', 'ZELL10', 6000, 'ZELL10:6000'],
  ['old order (keys missing)', undefined, undefined, 'none'],
  ['no coupon (0019)', null, 0, 'none'],
  ['code without discount', 'ZELL10', 0, 'none'],
  ['discount without code', null, 6000, 'none'],
  ['empty code', '', 6000, 'none'],
  ['discount fraction', 'ZELL10', 1.5, 'none'],
  ['discount string', 'ZELL10', '6000', 'none'],
]

// ───────────────────────── preview route ─────────────────────────

const VALID_PREVIEW_ROW = {
  ok: true,
  code: 'ZELL10',
  kind: 'percent',
  percent_off: 10,
  amount_off_piastres: null,
  max_discount_piastres: null,
  min_subtotal_piastres: 0,
}

type PreviewCase = {
  name: string
  enabled?: boolean
  headers?: Record<string, string>
  body?: string
  cookie?: string | undefined
  rpc?: PreviewRpcResult | 'throw'
  /** 'status:CODE' أو 'status:ok' */
  expected: string
  /** لازم الـrpc يتنادي ولا لأ */
  rpcCalled: boolean
}

const GOOD_HEADERS: Record<string, string> = {
  origin: 'https://zell.test',
  host: 'zell.test',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
}

function exactBody(totalBytes: number): string {
  const base = '{"code":"ZELL10"'
  return base + ' '.repeat(totalBytes - base.length - 1) + '}'
}

export const PREVIEW_ROUTE_CASES: ReadonlyArray<PreviewCase> = [
  { name: 'valid', expected: '200:ok', rpcCalled: true },
  { name: 'body exactly 512 bytes', body: exactBody(512), expected: '200:ok', rpcCalled: true },
  { name: 'orders disabled', enabled: false, expected: '503:ORDERS_DISABLED', rpcCalled: false },
  { name: 'cross-site', headers: { ...GOOD_HEADERS, 'sec-fetch-site': 'cross-site' }, expected: '403:BAD_ORIGIN', rpcCalled: false },
  { name: 'other origin', headers: { ...GOOD_HEADERS, origin: 'https://evil.test' }, expected: '403:BAD_ORIGIN', rpcCalled: false },
  {
    name: 'missing origin',
    headers: { host: 'zell.test', 'content-type': 'application/json' },
    expected: '403:BAD_ORIGIN',
    rpcCalled: false,
  },
  { name: 'missing cookie', cookie: undefined, expected: '400:CHECKOUT_SESSION_MISSING', rpcCalled: false },
  { name: 'blank cookie', cookie: '   ', expected: '400:CHECKOUT_SESSION_MISSING', rpcCalled: false },
  { name: 'text/plain', headers: { ...GOOD_HEADERS, 'content-type': 'text/plain' }, expected: '415:BAD_CONTENT_TYPE', rpcCalled: false },
  { name: 'declared length 600', headers: { ...GOOD_HEADERS, 'content-length': '600' }, expected: '413:BODY_TOO_LARGE', rpcCalled: false },
  { name: 'body 513 bytes', body: exactBody(513), expected: '413:BODY_TOO_LARGE', rpcCalled: false },
  { name: '300 arabic chars = 600 bytes', body: '{"code":"' + 'خ'.repeat(300) + '"}', expected: '413:BODY_TOO_LARGE', rpcCalled: false },
  { name: 'bad json', body: '{"code":', expected: '400:BAD_JSON', rpcCalled: false },
  { name: 'extra key', body: '{"code":"ZELL10","discount":100}', expected: '400:BAD_JSON', rpcCalled: false },
  { name: 'arabic code', body: '{"code":"خصم10"}', expected: '400:COUPON_INVALID', rpcCalled: false },
  { name: 'empty code', body: '{"code":""}', expected: '400:COUPON_INVALID', rpcCalled: false },
  { name: 'coupons disabled', rpc: { ok: false, status: 400, sqlMessage: 'ZELL_COUPONS_DISABLED' }, expected: '409:COUPONS_DISABLED', rpcCalled: true },
  { name: 'expired', rpc: { ok: false, status: 400, sqlMessage: 'ZELL_COUPON_EXPIRED' }, expected: '409:COUPON_EXPIRED', rpcCalled: true },
  { name: 'exhausted', rpc: { ok: false, status: 400, sqlMessage: 'ZELL_COUPON_EXHAUSTED' }, expected: '409:COUPON_EXHAUSTED', rpcCalled: true },
  { name: 'unknown in db', rpc: { ok: false, status: 400, sqlMessage: 'ZELL_COUPON_INVALID' }, expected: '400:COUPON_INVALID', rpcCalled: true },
  {
    name: 'raw sql error hidden',
    rpc: { ok: false, status: 403, sqlMessage: 'permission denied for function zell_preview_coupon' },
    expected: '500:INTERNAL',
    rpcCalled: true,
  },
  { name: 'rpc throws', rpc: 'throw', expected: '500:INTERNAL', rpcCalled: true },
  { name: 'extra key in db row', rpc: { ok: true, data: { ...VALID_PREVIEW_ROW, discount_piastres: 6000 } }, expected: '500:INTERNAL', rpcCalled: true },
  { name: 'db returns other code', rpc: { ok: true, data: { ...VALID_PREVIEW_ROW, code: 'OTHER1' } }, expected: '500:INTERNAL', rpcCalled: true },
]

const EXPECTED_VALID_BODY =
  '{"ok":true,"coupon":{"code":"ZELL10","kind":"percent","percentOff":10,"amountOffPiastres":null,' +
  '"maxDiscountPiastres":null,"minSubtotalPiastres":0}}'

// ───────────────────────── runner ─────────────────────────

export async function runStorefrontCouponCases(): Promise<StorefrontCouponCaseFailure[]> {
  const failures: StorefrontCouponCaseFailure[] = []
  const check = (name: string, expected: string, actual: string) => {
    if (expected !== actual) failures.push({ name, expected, actual })
  }

  for (const [name, order, expected] of CANONICAL_CASES) {
    check('canonical: ' + name, expected, canonicalOrderJson(normalizeOrder(order)))
  }
  // المفتاح مربوط بـcanonical بالمساواة الحرفية (resolveIdempotencyKey) — canonical مختلف = مفتاح جديد
  const withA = canonicalOrderJson(normalizeOrder({ ...BASE_ORDER, couponCode: 'ZELL10' }))
  const withB = canonicalOrderJson(normalizeOrder({ ...BASE_ORDER, couponCode: 'ZELL20' }))
  const without = canonicalOrderJson(normalizeOrder(BASE_ORDER))
  check('canonical: change code → new canonical', 'true', String(withA !== withB))
  check('canonical: remove code → new canonical', 'true', String(withA !== without))

  for (const [name, raw, expected] of ORDER_FIELD_CASES) {
    const result = parseCouponCodeField(raw)
    check('order field: ' + name, expected, !result.ok ? 'invalid' : result.code === null ? 'none' : result.code)
  }

  for (const [name, payload, expected] of PREVIEW_BODY_CASES) {
    const result = parsePreviewBody(payload)
    check('preview body: ' + name, expected, result.code)
  }

  for (const [message, code, status] of SQL_ERROR_CASES) {
    const actual = codeFromSqlError(message)
    check('sql error: ' + message, code + ':' + String(status), actual + ':' + String(statusFor(actual)))
    const failure = orderFailure(actual)
    check('sql error hidden: ' + message, 'false', String(failure.message.includes('ZELL') || failure.message.includes(message)))
    if (code !== 'INTERNAL') check('sql error not retryable: ' + message, 'false', String(failure.retryable))
  }

  for (const [message, expected] of PREVIEW_SQL_CASES) {
    check('preview sql: ' + message, expected, previewCodeFromSqlError(message))
  }

  for (const [name, raw, expected] of RESULT_CASES) {
    if (!isCreateOrderResult(raw)) {
      check('result: ' + name, expected, 'rejected')
      continue
    }
    const order = orderSuccessBody(raw as CreateOrderResult).order
    check(
      'result: ' + name,
      expected,
      String(order.couponCode) + ':' + String(order.discountPiastres) + ':' + String(order.totalPiastres) + ':' + String(order.replayed),
    )
  }

  for (const [name, code, piastres, expected] of DISCOUNT_LINE_CASES) {
    const line = discountLine(code, piastres)
    check('discount line: ' + name, expected, line === null ? 'none' : line.code + ':' + String(line.piastres))
  }
  check('discount label', 'خصم (ZELL10)', discountLabel('ZELL10'))
  check('discount sign', '\u2212', DISCOUNT_SIGN)

  for (const testCase of PREVIEW_ROUTE_CASES) {
    const calls: string[] = []
    const body = testCase.body ?? '{"code":" zell10 "}'
    const outcome = await handleCouponPreview(
      {
        request: { headers: new Headers(testCase.headers ?? GOOD_HEADERS), text: async () => body },
        fallbackHost: 'zell.test',
        sessionCookie: 'cookie' in testCase ? testCase.cookie : 'session-secret',
      },
      {
        ordersEnabled: testCase.enabled ?? true,
        rpc: async (code) => {
          calls.push(code)
          if (testCase.rpc === 'throw') throw new TypeError('network')
          return testCase.rpc ?? { ok: true, data: VALID_PREVIEW_ROW }
        },
        log: () => undefined,
      },
    )
    const label = outcome.body.ok ? 'ok' : outcome.body.code
    check('preview route: ' + testCase.name, testCase.expected, String(outcome.status) + ':' + label)
    check('preview route rpc called: ' + testCase.name, String(testCase.rpcCalled), String(calls.length === 1))
    if (calls.length === 1 && testCase.rpc === undefined) check('preview route rpc code: ' + testCase.name, 'ZELL10', calls[0] ?? '')
    if (outcome.body.ok) check('preview route body: ' + testCase.name, EXPECTED_VALID_BODY, JSON.stringify(outcome.body))
    if (!outcome.body.ok) {
      check('preview route hides sql: ' + testCase.name, 'false', String(/ZELL_|permission|zell_preview/.test(outcome.body.message)))
    }
  }

  return failures
}
