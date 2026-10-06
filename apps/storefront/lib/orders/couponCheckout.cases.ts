/**
 * حالات اختبار PR4 (كوبون صفحة الطلب) — من غير مكتبة اختبار ومن غير أي نداء شبكة.
 * runCheckoutCouponCases() بترجّع الحالات اللي فشلت بس (فاضية = كله تمام). الـCI بيعمل typecheck
 * للملف ده، ومحدش بيستورده فمابيدخلش في الـbundle.
 */

import type { CouponTerms } from '@zell/core'
import { parseCheckoutDraft } from '../drafts'
import { canonicalOrderJson, normalizeOrder } from './canonical'
import type { OrderRequest } from './contracts'
import {
  COUPON_LOCK_MESSAGE,
  INITIAL_COUPON_STATE,
  couponBlockReason,
  couponDraftCode,
  couponPayloadField,
  couponReducer,
  estimateCoupon,
  estimatedTotalPiastres,
  minSubtotalMessage,
  parsePreviewReply,
  planApply,
  type CouponAction,
  type CouponEstimate,
  type CouponState,
} from './couponCheckout'

export type CheckoutCouponCaseFailure = { name: string; expected: string; actual: string }

function pct(code: string, percentOff: number, maxDiscountPiastres: number | null = null, minSubtotalPiastres = 0): CouponTerms {
  return { code, kind: 'percent', percentOff, amountOffPiastres: null, maxDiscountPiastres, minSubtotalPiastres }
}

function fixed(code: string, amountOffPiastres: number, minSubtotalPiastres = 0): CouponTerms {
  return { code, kind: 'fixed', percentOff: null, amountOffPiastres, maxDiscountPiastres: null, minSubtotalPiastres }
}

function run(actions: CouponAction[], from: CouponState = INITIAL_COUPON_STATE): CouponState {
  return actions.reduce(couponReducer, from)
}

/** كوبون مطبّق بمعاينة ناجحة. */
function applied(terms: CouponTerms): CouponState {
  return run([
    { type: 'toggle' },
    { type: 'input', value: terms.code.toLowerCase() },
    { type: 'apply_start', code: terms.code },
    { type: 'preview_ok', code: terms.code, terms },
  ])
}

function show(estimate: CouponEstimate): string {
  if (estimate.kind === 'ok') return 'ok:' + String(estimate.discountPiastres)
  if (estimate.kind === 'below_minimum') return 'below_minimum:' + String(estimate.minSubtotalPiastres)
  return estimate.kind
}

const ZELL10 = pct('ZELL10', 10)
const HALF50 = pct('HALF50', 50, 10000)
const FIX5000 = fixed('FIX5000', 5000)
const MIN500 = pct('MIN500', 10, null, 50000)
const ONE1PCT = pct('ONE1PCT', 1)

/** [الاسم، الشروط، subtotal، المتوقع] — التقدير من شروط المعاينة بس */
export const ESTIMATE_CASES: ReadonlyArray<readonly [string, CouponTerms, number, string]> = [
  ['percent 10% of 600', ZELL10, 60000, 'ok:6000'],
  ['percent rounds half up (6172.5)', ZELL10, 61725, 'ok:6173'],
  ['percent capped at 100', HALF50, 60000, 'ok:10000'],
  ['fixed 50', FIX5000, 60000, 'ok:5000'],
  ['fixed above subtotal', FIX5000, 3000, 'ok:3000'],
  ['min exact', MIN500, 50000, 'ok:5000'],
  ['min minus one piastre', MIN500, 49999, 'below_minimum:50000'],
  ['1% of 10 piastres', ONE1PCT, 10, 'not_applicable'],
]

const BASE_PAYLOAD: OrderRequest = {
  customerName: 'أحمد علي',
  customerPhone: '01012345678',
  governorate: 'القاهرة',
  address: 'شارع التحرير ١٠ الدور الثالث',
  notes: null,
  items: [{ productId: 7, lengthCm: 150 }],
}

export function runCheckoutCouponCases(): CheckoutCouponCaseFailure[] {
  const failures: CheckoutCouponCaseFailure[] = []
  const check = (name: string, expected: string, actual: string) => {
    if (expected !== actual) failures.push({ name, expected, actual })
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

  // ── الميزة مقفولة: مفيش خانة ولا تغيير في الطلب ──
  check('off: estimate', 'none', show(estimateCoupon(null, 60000)))
  check('off: no block', 'null', String(couponBlockReason(null, { kind: 'none' })))
  check('off: payload has no key', '{}', JSON.stringify(couponPayloadField(null)))
  check(
    'off: total = old formula',
    String(60000 + 8000 + 30000 + 5000),
    String(estimatedTotalPiastres({ subtotalPiastres: 60000, discountPiastres: 0, shippingPiastres: 8000, installationPiastres: 30000, travelPiastres: 5000 })),
  )

  // ── فتح وإغلاق القسم ──
  check('toggle: opens', 'true', String(run([{ type: 'toggle' }]).open))
  check('toggle: closes', 'false', String(run([{ type: 'toggle' }, { type: 'toggle' }]).open))
  check('toggle: ignored while applied', 'true', String(couponReducer(applied(ZELL10), { type: 'toggle' }).open))

  // ── كود غير صالح محليًا: مفيش نداء شبكة ──
  const typedArabic = run([{ type: 'toggle' }, { type: 'input', value: 'خصم' }])
  check('invalid: plan', 'invalid', planApply(typedArabic).kind)
  const invalid = couponReducer(typedArabic, { type: 'apply_invalid' })
  check('invalid: phase', 'error', invalid.phase)
  check('invalid: message', 'كود الخصم غير صحيح.', String(invalid.error))
  check('invalid: empty input', 'invalid', planApply(run([{ type: 'toggle' }])).kind)
  const typed = run([{ type: 'toggle' }, { type: 'input', value: ' zell10 ' }])
  const plan = planApply(typed)
  check('apply: plan normalizes', 'fetch:ZELL10', plan.kind === 'fetch' ? 'fetch:' + plan.code : plan.kind)

  // ── المعاينة: loading ومنع الضغط المتكرر ──
  const checking = couponReducer(typed, { type: 'apply_start', code: 'ZELL10' })
  check('checking: phase', 'checking', checking.phase)
  check('checking: repeat click blocked', 'busy', planApply(checking).kind)
  check('checking: estimate', 'checking', show(estimateCoupon(checking, 60000)))
  check('checking: submit blocked', 'true', String(couponBlockReason(checking, estimateCoupon(checking, 60000)) !== null))
  check('checking: input frozen', 'ZELL10', couponReducer(checking, { type: 'input', value: 'OTHER' }).input)
  check('checking: stale reply ignored', 'checking', couponReducer(checking, { type: 'preview_ok', code: 'OTHER1', terms: pct('OTHER1', 5) }).phase)
  const ok = couponReducer(checking, { type: 'preview_ok', code: 'ZELL10', terms: ZELL10 })
  check('preview ok: applied', 'ZELL10', String(ok.applied?.code))
  check('preview ok: estimate', 'ok:6000', show(estimateCoupon(ok, 60000)))
  check('preview ok: no block', 'null', String(couponBlockReason(ok, estimateCoupon(ok, 60000))))
  const failed = couponReducer(checking, { type: 'preview_failed', code: 'ZELL10', message: 'كود الخصم ده خلص.' })
  check('preview failed: not applied', 'null', String(failed.applied))
  check('preview failed: message', 'كود الخصم ده خلص.', String(failed.error))
  check('preview failed: typed code blocks submit', 'true', String(couponBlockReason(failed, estimateCoupon(failed, 60000)) !== null))

  // ── شكل رد المعاينة ──
  const reply = (value: unknown, code = 'ZELL10') => {
    const result = parsePreviewReply(value, code)
    return result.ok ? 'ok:' + JSON.stringify(result.terms) : 'fail:' + result.message
  }
  check('reply: valid', 'ok:' + JSON.stringify(ZELL10), reply({ ok: true, coupon: ZELL10 }))
  check('reply: extra amount dropped', 'ok:' + JSON.stringify(ZELL10), reply({ ok: true, coupon: { ...ZELL10, discountPiastres: 6000 } }))
  check('reply: other code', 'fail:مقدرناش نتأكد من الكود دلوقتي. جرّب تاني.', reply({ ok: true, coupon: pct('OTHER1', 5) }))
  check('reply: bad terms', 'fail:مقدرناش نتأكد من الكود دلوقتي. جرّب تاني.', reply({ ok: true, coupon: pct('ZELL10', 0) }))
  check('reply: known error uses table', 'fail:كود الخصم ده مش ساري دلوقتي.', reply({ ok: false, code: 'COUPON_EXPIRED', message: 'ZELL_COUPON_EXPIRED raw' }))
  check('reply: disabled', 'fail:أكواد الخصم مش متاحة دلوقتي. شيل الكود وكمّل طلبك.', reply({ ok: false, code: 'COUPONS_DISABLED', message: 'x' }))
  check('reply: unknown error generic', 'fail:مقدرناش نتأكد من الكود دلوقتي. جرّب تاني.', reply({ ok: false, code: 'WHATEVER', message: 'permission denied' }))
  check('reply: not json', 'fail:مقدرناش نتأكد من الكود دلوقتي. جرّب تاني.', reply(null))

  // ── نسبة · cap · ثابت · حد أدنى ──
  for (const [name, terms, subtotal, expected] of ESTIMATE_CASES) {
    check('estimate: ' + name, expected, show(estimateCoupon(applied(terms), subtotal)))
  }
  const notApplicable = applied(ONE1PCT)
  check('estimate: not applicable blocks', 'true', String(couponBlockReason(notApplicable, estimateCoupon(notApplicable, 10)) !== null))
  check(
    'total: discount on items only',
    String(60000 - 6000 + 8000 + 30000 + 5000),
    String(estimatedTotalPiastres({ subtotalPiastres: 60000, discountPiastres: 6000, shippingPiastres: 8000, installationPiastres: 30000, travelPiastres: 5000 })),
  )

  // ── إزالة الكود ──
  const removed = couponReducer(applied(ZELL10), { type: 'remove' })
  check('remove: cleared', 'idle||null', removed.phase + '|' + removed.input + '|' + String(removed.applied))
  check('remove: estimate none', 'none', show(estimateCoupon(removed, 60000)))
  check('remove: no block', 'null', String(couponBlockReason(removed, estimateCoupon(removed, 60000))))

  // ── تغيّر السلة بعد التطبيق (ومنه شيل أدوات الفني) ──
  const min = applied(MIN500)
  check('cart: above min', 'ok:6000', show(estimateCoupon(min, 60000)))
  check('cart: dropped below min', 'below_minimum:50000', show(estimateCoupon(min, 40000)))
  check('cart: back above min', 'ok:6000', show(estimateCoupon(min, 60000)))
  // فيلم 450 + أدوات 70 = 520 فوق الحد؛ «شيل الأدوات» → 450 تحت الحد → التأكيد يتقفل
  check('tools: with tools ok', 'ok:5200', show(estimateCoupon(min, 52000)))
  check('tools: removing tools breaks min', minSubtotalMessage(50000), String(couponBlockReason(min, estimateCoupon(min, 45000))))

  // ── المسودة: قديمة · حديثة · تالفة ──
  const oldDraft = { customerName: 'أحمد', customerPhone: '010', governorate: 'القاهرة', area: '', address: 'عنوان', notes: '', showNotes: false }
  check('draft: old storage valid', JSON.stringify(oldDraft), JSON.stringify(parseCheckoutDraft(oldDraft)))
  check('draft: with code', 'ZELL10', String(parseCheckoutDraft({ ...oldDraft, couponCode: 'ZELL10' })?.couponCode))
  check('draft: lowercase code = corrupt', 'null', String(parseCheckoutDraft({ ...oldDraft, couponCode: 'zell10' })))
  check('draft: number code = corrupt', 'null', String(parseCheckoutDraft({ ...oldDraft, couponCode: 10 })))
  check('draft: long code = corrupt', 'null', String(parseCheckoutDraft({ ...oldDraft, couponCode: 'A'.repeat(33) })))
  check('draft: missing field = corrupt', 'null', String(parseCheckoutDraft({ ...oldDraft, customerName: undefined })))
  check(
    'draft: stored amount ignored',
    JSON.stringify({ ...oldDraft, couponCode: 'ZELL10' }),
    JSON.stringify(parseCheckoutDraft({ ...oldDraft, couponCode: 'ZELL10', discountPiastres: 6000, terms: ZELL10 })),
  )

  // ── الاسترجاع: معاينة جديدة، ومش مطبّق قبل نجاحها ──
  const restoring = run([{ type: 'restore', code: 'ZELL10' }])
  check('restore: opens + checking', 'true|checking|null', String(restoring.open) + '|' + restoring.phase + '|' + String(restoring.applied))
  check('restore: not trusted yet', 'checking', show(estimateCoupon(restoring, 60000)))
  check('restore: kept in draft while checking', 'ZELL10', String(couponDraftCode(restoring)))
  const restoreFailed = couponReducer(restoring, { type: 'preview_failed', code: 'ZELL10', message: 'كود الخصم ده خلص.' })
  check('restore failed: not applied', 'null', String(restoreFailed.applied))
  check('restore failed: dropped from draft', 'undefined', String(couponDraftCode(restoreFailed)))
  const restoreOk = couponReducer(restoring, { type: 'preview_ok', code: 'ZELL10', terms: ZELL10 })
  check('restore ok: applied', 'ZELL10', String(restoreOk.applied?.code))
  check('restore: corrupt code ignored', 'idle', run([{ type: 'restore', code: 'zell10' }]).phase)

  // ── payload: الكود بس ──
  check('payload: code only', '{"couponCode":"ZELL10"}', JSON.stringify(couponPayloadField('ZELL10')))
  check('payload: no coupon = old body', JSON.stringify(BASE_PAYLOAD), JSON.stringify({ ...BASE_PAYLOAD, ...couponPayloadField(null) }))

  // ── retry: canonical والمفتاح ثابتين (نفس قاعدة resolveIdempotencyKey: مساواة canonical) ──
  const intents = new Map<string, string>()
  const keyFor = (state: CouponState) => {
    const canonical = canonicalOrderJson(normalizeOrder({ ...BASE_PAYLOAD, ...couponPayloadField(state.applied?.code ?? null) }))
    const existing = intents.get(canonical)
    if (existing !== undefined) return existing
    const key = 'k' + String(intents.size + 1)
    intents.set(canonical, key)
    return key
  }
  const before = applied(ZELL10)
  const firstKey = keyFor(before)
  // شبكة وقعت → قفل؛ محاولات تغيير الكود بتتجاهل، فالإعادة بنفس canonical ونفس المفتاح
  const afterNetwork = run(
    [{ type: 'submit_outcome', outcome: { kind: 'network' } }, { type: 'remove' }, { type: 'input', value: 'OTHER1' }, { type: 'apply_start', code: 'OTHER1' }],
    before,
  )
  check('retry: same key after network', firstKey, keyFor(afterNetwork))
  check('retry: code unchanged', 'ZELL10', String(afterNetwork.applied?.code))

  // ── القفل ──
  for (const [name, outcome] of [
    ['timeout/network', { kind: 'network' }],
    ['unexpected reply', { kind: 'unexpected' }],
    ['retryable failure', { kind: 'failure', code: 'INTERNAL', retryable: true }],
  ] as const) {
    const locked = couponReducer(applied(MIN500), { type: 'submit_outcome', outcome })
    check('lock: ' + name, 'true', String(locked.locked))
    check('lock: remove ignored after ' + name, 'MIN500', String(couponReducer(locked, { type: 'remove' }).applied?.code))
    check('lock: no dead end after ' + name, 'null', String(couponBlockReason(locked, estimateCoupon(locked, 40000))))
  }
  const locked = couponReducer(applied(ZELL10), { type: 'submit_outcome', outcome: { kind: 'network' } })
  check('lock: message constant', 'حالة الطلب غير محسومة. حاول تأكيد نفس الطلب مرة تانية قبل تغيير الكود.', COUPON_LOCK_MESSAGE)
  check('unlock: success', 'false', String(couponReducer(locked, { type: 'submit_outcome', outcome: { kind: 'success' } }).locked))
  const unlocked = couponReducer(locked, { type: 'submit_outcome', outcome: { kind: 'failure', code: 'ITEM_UNAVAILABLE', retryable: false } })
  check('unlock: non-retryable', 'false|null', String(unlocked.locked) + '|' + String(unlocked.rejection))
  check('unlock: remove works again', 'null', String(couponReducer(unlocked, { type: 'remove' }).applied))

  // ── أخطاء الكوبون من إنشاء الأوردر: رسالة + «شيل الكود»، من غير إرسال تلقائي ──
  const phoneLimit = couponReducer(applied(ZELL10), { type: 'submit_outcome', outcome: { kind: 'failure', code: 'COUPON_PHONE_LIMIT', retryable: false } })
  check('reject: message', 'كود الخصم ده اتستخدم قبل كده برقم الموبايل ده.', String(phoneLimit.rejection))
  check('reject: code kept (no silent resend)', 'ZELL10', String(phoneLimit.applied?.code))
  check('reject: remove clears', 'null|null', String(couponReducer(phoneLimit, { type: 'remove' }).rejection) + '|' + String(couponReducer(phoneLimit, { type: 'remove' }).applied))
  check('reject: next submit clears message', 'null', String(couponReducer(phoneLimit, { type: 'submit_start' }).rejection))
  const minReject = couponReducer(applied(MIN500), { type: 'submit_outcome', outcome: { kind: 'failure', code: 'COUPON_MIN_SUBTOTAL', retryable: false } })
  check('reject: min uses preview terms', minSubtotalMessage(50000), String(minReject.rejection))

  // ── من غير كوبون: نفس السلوك القديم (لا قفل ولا رسالة) ──
  const noCoupon = run([
    { type: 'submit_start' },
    { type: 'submit_outcome', outcome: { kind: 'network' } },
    { type: 'submit_outcome', outcome: { kind: 'failure', code: 'INTERNAL', retryable: true } },
    { type: 'submit_outcome', outcome: { kind: 'failure', code: 'COUPON_INVALID', retryable: false } },
    { type: 'submit_outcome', outcome: { kind: 'unexpected' } },
  ])
  check('no coupon: state untouched', 'true', String(same(noCoupon, INITIAL_COUPON_STATE)))

  return failures
}
