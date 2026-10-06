/**
 * كوبون صفحة الطلب (0019 · PR4) — منطق خالص للحالة والتقدير والقفل، من غير React ولا fetch،
 * عشان يتختبر لوحده. الواجهة في components/store/CouponBox.tsx والربط في lib/useCheckoutCoupon.ts.
 *
 * 🔒 ثوابت:
 *   • الكود بيتعتبر «مطبّق» بس بعد معاينة ناجحة (preview_ok) — ولا قبلها حتى لو جاي من المسودة.
 *   • التقدير من شروط المعاينة بس (couponDiscountPiastres) على subtotal الحالي، وبيتحسب تاني مع
 *     أي تغيير في السلة. مفيش أي مبلغ بيتبعت للسيرفر ولا بيتحفظ — الداتابيز هي الحكم وقت الطلب.
 *   • الخصم على الأصناف بس. الشحن المجاني بيتحسب برّه على subtotal قبل الخصم.
 *   • قفل الكود (العقد في lib/orders/coupon.ts): نتيجة مش محسومة مع كوبون → تغيير الكود وشيله
 *     ممنوعين لحد ما إرسال بنفس canonical يرجّع نجاح أو رفض واضح (retryable = false).
 *     من غير كوبون مفيش قفل خالص.
 */

import { couponDiscountPiastres, formatPiastres, isValidCouponTerms, normalizeCouponCode, type CouponTerms } from '@zell/core'
import type { OrderErrorCode } from './contracts'
import { ORDER_ERRORS } from './errors'

export const COUPON_ERROR_CODES = [
  'COUPON_INVALID',
  'COUPON_EXPIRED',
  'COUPON_EXHAUSTED',
  'COUPON_MIN_SUBTOTAL',
  'COUPON_PHONE_LIMIT',
  'COUPON_NOT_APPLICABLE',
  'COUPONS_DISABLED',
] as const

export type CouponErrorCode = (typeof COUPON_ERROR_CODES)[number]

export function isCouponErrorCode(code: string): code is CouponErrorCode {
  return (COUPON_ERROR_CODES as readonly string[]).includes(code)
}

export const COUPON_LOCK_MESSAGE = 'حالة الطلب غير محسومة. حاول تأكيد نفس الطلب مرة تانية قبل تغيير الكود.'
export const COUPON_NETWORK_MESSAGE = 'الشبكة وقعت. جرّب تطبيق الكود تاني.'
const COUPON_GENERIC_MESSAGE = 'مقدرناش نتأكد من الكود دلوقتي. جرّب تاني.'
const COUPON_NOT_APPLICABLE_MESSAGE = 'الكود ده مالوش خصم على السلة دي. شيل الكود عشان تكمل.'
const COUPON_CHECKING_MESSAGE = 'استنى لحظة — بنتأكد من كود الخصم.'
const COUPON_UNAPPLIED_MESSAGE = 'دوس «تطبيق» على كود الخصم أو امسحه الأول.'

export function minSubtotalMessage(minSubtotalPiastres: number): string {
  return 'الكود ده بيشتغل على أصناف بـ' + formatPiastres(minSubtotalPiastres) + ' أو أكتر. زوّد السلة أو شيل الكود.'
}

/**
 * رسالة خطأ الكوبون — من جدول أخطاء السيرفر بالكود (مش من نص الرد)، فمستحيل رسالة SQL توصل.
 * COUPON_MIN_SUBTOTAL بالرقم من شروط المعاينة لو متاحة.
 */
export function couponErrorMessage(code: string, terms: CouponTerms | null): string {
  if (code === 'COUPON_MIN_SUBTOTAL' && terms !== null && terms.minSubtotalPiastres > 0) {
    return minSubtotalMessage(terms.minSubtotalPiastres)
  }
  if (Object.prototype.hasOwnProperty.call(ORDER_ERRORS, code)) return ORDER_ERRORS[code as OrderErrorCode].message
  return COUPON_GENERIC_MESSAGE
}

/** رد POST /api/coupons/preview → شروط (نسخة نضيفة) أو رسالة. أي شكل غريب = رسالة عامة. */
export function parsePreviewReply(
  value: unknown,
  requestedCode: string,
): { ok: true; terms: CouponTerms } | { ok: false; message: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, message: COUPON_GENERIC_MESSAGE }
  const record = value as Record<string, unknown>
  if (record['ok'] === true) {
    const coupon = record['coupon']
    if (!isValidCouponTerms(coupon) || coupon.code !== requestedCode) return { ok: false, message: COUPON_GENERIC_MESSAGE }
    const terms: CouponTerms =
      coupon.kind === 'percent'
        ? {
            code: coupon.code,
            kind: 'percent',
            percentOff: coupon.percentOff,
            amountOffPiastres: null,
            maxDiscountPiastres: coupon.maxDiscountPiastres,
            minSubtotalPiastres: coupon.minSubtotalPiastres,
          }
        : {
            code: coupon.code,
            kind: 'fixed',
            percentOff: null,
            amountOffPiastres: coupon.amountOffPiastres,
            maxDiscountPiastres: null,
            minSubtotalPiastres: coupon.minSubtotalPiastres,
          }
    return { ok: true, terms }
  }
  if (record['ok'] === false && typeof record['code'] === 'string') {
    return { ok: false, message: couponErrorMessage(record['code'], null) }
  }
  return { ok: false, message: COUPON_GENERIC_MESSAGE }
}

// ── الحالة ──────────────────────────────────────────────────

export type AppliedCoupon = { code: string; terms: CouponTerms }

export type CouponState = {
  open: boolean
  input: string
  phase: 'idle' | 'checking' | 'applied' | 'error'
  /** الكود اللي معاينته شغالة دلوقتي — رد لكود تاني بيتجاهل. */
  pendingCode: string | null
  /** المعاينة الحالية جاية من المسودة (مش من ضغطة «تطبيق»). */
  restoring: boolean
  applied: AppliedCoupon | null
  /** فشل التطبيق أو المعاينة. */
  error: string | null
  /** رفض الكوبون من إنشاء الأوردر — الكود فاضل والعميل يشيله بإيده. */
  rejection: string | null
  locked: boolean
}

export const INITIAL_COUPON_STATE: CouponState = {
  open: false,
  input: '',
  phase: 'idle',
  pendingCode: null,
  restoring: false,
  applied: null,
  error: null,
  rejection: null,
  locked: false,
}

export type SubmitOutcome =
  | { kind: 'success' }
  | { kind: 'failure'; code: string; retryable: boolean }
  | { kind: 'network' }
  | { kind: 'unexpected' }

export type CouponAction =
  | { type: 'toggle' }
  | { type: 'input'; value: string }
  | { type: 'apply_invalid' }
  | { type: 'apply_start'; code: string }
  | { type: 'restore'; code: string }
  | { type: 'preview_ok'; code: string; terms: CouponTerms }
  | { type: 'preview_failed'; code: string; message: string }
  | { type: 'remove' }
  | { type: 'submit_start' }
  | { type: 'submit_outcome'; outcome: SubmitOutcome }

/** الكود مش قابل للتعديل: مقفول، أو معاينته شغالة. */
function frozen(state: CouponState): boolean {
  return state.locked || state.phase === 'checking'
}

/** قرار «تطبيق» قبل أي نداء: مشغول (ممنوع ضغط متكرر) · غير صالح محليًا · معاينة لكود متطبّع. */
export function planApply(state: CouponState): { kind: 'busy' } | { kind: 'invalid' } | { kind: 'fetch'; code: string } {
  if (frozen(state) || state.applied !== null) return { kind: 'busy' }
  const code = normalizeCouponCode(state.input)
  return code === null ? { kind: 'invalid' } : { kind: 'fetch', code }
}

export function couponReducer(state: CouponState, action: CouponAction): CouponState {
  switch (action.type) {
    case 'toggle':
      // مايتقفلش وفي كود مطبّق أو بيتفحص أو مقفول — الكود لازم يفضل قدام العميل
      if (frozen(state) || state.applied !== null) return state
      return { ...state, open: !state.open, error: state.open ? null : state.error }
    case 'input':
      if (frozen(state) || state.applied !== null) return state
      return { ...state, input: action.value, phase: 'idle', error: null }
    case 'apply_invalid':
      if (frozen(state) || state.applied !== null) return state
      return { ...state, phase: 'error', error: couponErrorMessage('COUPON_INVALID', null) }
    case 'apply_start':
      if (frozen(state) || state.applied !== null || normalizeCouponCode(action.code) !== action.code) return state
      return { ...state, input: action.code, phase: 'checking', pendingCode: action.code, restoring: false, error: null, rejection: null }
    case 'restore':
      if (state.locked || state.applied !== null || normalizeCouponCode(action.code) !== action.code) return state
      return { ...state, open: true, input: action.code, phase: 'checking', pendingCode: action.code, restoring: true, error: null }
    case 'preview_ok':
      if (state.phase !== 'checking' || state.pendingCode !== action.code || action.terms.code !== action.code) return state
      return { ...state, phase: 'applied', applied: { code: action.code, terms: action.terms }, pendingCode: null, restoring: false, error: null }
    case 'preview_failed':
      if (state.phase !== 'checking' || state.pendingCode !== action.code) return state
      return { ...state, phase: 'error', pendingCode: null, restoring: false, error: action.message }
    case 'remove':
      if (frozen(state)) return state
      return { ...state, input: '', phase: 'idle', applied: null, error: null, rejection: null, pendingCode: null, restoring: false }
    case 'submit_start':
      return state.rejection === null ? state : { ...state, rejection: null }
    case 'submit_outcome': {
      const outcome = action.outcome
      if (outcome.kind === 'success') return { ...state, locked: false }
      if (outcome.kind === 'failure' && !outcome.retryable) {
        const rejection =
          state.applied !== null && isCouponErrorCode(outcome.code) ? couponErrorMessage(outcome.code, state.applied.terms) : null
        return { ...state, locked: false, rejection }
      }
      // network · unexpected · retryable → مش محسومة: القفل بس لو في كوبون
      return state.applied === null ? state : { ...state, locked: true }
    }
  }
}

// ── التقدير والحاجز ─────────────────────────────────────────

export type CouponEstimate =
  | { kind: 'none' }
  | { kind: 'checking' }
  | { kind: 'ok'; code: string; discountPiastres: number }
  | { kind: 'below_minimum'; code: string; minSubtotalPiastres: number }
  | { kind: 'not_applicable'; code: string }

/** state = null → الميزة مقفولة (مفيش كوبون خالص). */
export function estimateCoupon(state: CouponState | null, subtotalPiastres: number): CouponEstimate {
  if (state === null) return { kind: 'none' }
  if (state.phase === 'checking') return { kind: 'checking' }
  if (state.applied === null) return { kind: 'none' }
  const { code, terms } = state.applied
  const result = couponDiscountPiastres(terms, subtotalPiastres)
  if (result.status === 'ok') return { kind: 'ok', code, discountPiastres: result.discountPiastres }
  if (result.status === 'below_minimum') return { kind: 'below_minimum', code, minSubtotalPiastres: result.minSubtotalPiastres }
  return { kind: 'not_applicable', code }
}

/**
 * سبب قفل التأكيد بسبب الكوبون، أو null. وهو مقفول (نتيجة مش محسومة) مفيش حاجز هنا: الداتابيز
 * تحسم، وإلا العميل يبقى في طريق مسدود (مايقدرش يشيل الكود ولا يأكد).
 */
export function couponBlockReason(state: CouponState | null, estimate: CouponEstimate): string | null {
  if (state === null || state.locked) return null
  if (estimate.kind === 'checking') return COUPON_CHECKING_MESSAGE
  if (estimate.kind === 'below_minimum') return minSubtotalMessage(estimate.minSubtotalPiastres)
  if (estimate.kind === 'not_applicable') return COUPON_NOT_APPLICABLE_MESSAGE
  // كود مكتوب ومش مطبّق — مانبعتش الطلب من غيره بصمت
  if (state.applied === null && state.open && state.input.trim() !== '') return COUPON_UNAPPLIED_MESSAGE
  return null
}

/** الإجمالي التقديري: subtotal − الخصم + الشحن + أجر الفني + الانتقال. */
export function estimatedTotalPiastres(parts: {
  subtotalPiastres: number
  discountPiastres: number
  shippingPiastres: number | null
  installationPiastres: number | null
  travelPiastres: number | null
}): number {
  return (
    parts.subtotalPiastres -
    parts.discountPiastres +
    (parts.shippingPiastres ?? 0) +
    (parts.installationPiastres ?? 0) +
    (parts.travelPiastres ?? 0)
  )
}

/** حقل الطلب: الكود المطبّق بس، ومن غيره مفيش مفتاح خالص (الـbody القديم بالحرف). */
export function couponPayloadField(code: string | null): { couponCode?: string } {
  return code === null ? {} : { couponCode: code }
}

/** الكود اللي يتحفظ في المسودة: المطبّق، أو المسترجع اللي لسه بيتفحص (عشان مايضيعش). مفيش مبلغ ولا شروط. */
export function couponDraftCode(state: CouponState): string | undefined {
  if (state.applied !== null) return state.applied.code
  if (state.restoring && state.pendingCode !== null) return state.pendingCode
  return undefined
}
