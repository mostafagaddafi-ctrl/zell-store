/**
 * جدول الأخطاء — ORDER-FLOW-PLAN.md §1.3.
 *
 * 🔒 قواعد ثابتة:
 *   • الرسالة **دايماً** من الجدول ده. مفيش err.message بيوصل للعميل أبداً.
 *   • CONCURRENT_SUBMIT كود مستقل — ممنوع يتحوّل لـITEM_UNAVAILABLE (ت٥).
 *   • REPLAY_NOT_AUTHORIZED صياغته محايدة عن قصد — لا بيقول الطلب موجود
 *     ولا مش موجود، عشان ما يبقاش oracle.
 *   • قاعدة التسمية (ب١٤): كود SQL = ZELL_ + الكود هنا، بدون استثناء،
 *     فالربط ميكانيكي بشيل البادئة.
 */

import type { CouponPreviewErrorCode, OrderErrorCode, OrderFailure } from './contracts'

type ErrorSpec = {
  status: number
  message: string
  retryable: boolean
}

export const ORDER_ERRORS: Record<OrderErrorCode, ErrorSpec> = {
  ORDERS_DISABLED: { status: 503, message: 'تأكيد الطلب مش متاح دلوقتي. كلّمنا على واتساب.', retryable: false },
  BAD_ORIGIN: { status: 403, message: 'طلب غير صحيح.', retryable: false },
  BAD_CONTENT_TYPE: { status: 415, message: 'طلب غير صحيح.', retryable: false },
  BODY_TOO_LARGE: { status: 413, message: 'البيانات المرسلة كبيرة جداً.', retryable: false },
  BAD_JSON: { status: 400, message: 'طلب غير صحيح.', retryable: false },
  CHECKOUT_SESSION_MISSING: {
    status: 400,
    message: 'حدّث الصفحة وجرّب تاني. لازم الكوكيز تكون مسموحة لتأكيد الطلب.',
    retryable: true,
  },
  IDEMPOTENCY_REQUIRED: { status: 400, message: 'طلب غير صحيح.', retryable: false },
  IDEMPOTENCY_MISMATCH: { status: 409, message: 'البيانات اتغيّرت. حدّث الصفحة وجرّب تاني.', retryable: false },
  REPLAY_NOT_AUTHORIZED: {
    status: 409,
    message: 'تعذّر تأكيد الطلب من المتصفح ده. لو طلبك اتسجّل هنكلّمك عليه.',
    retryable: false,
  },
  CART_EMPTY: { status: 400, message: 'السلة فاضية.', retryable: false },
  CART_TOO_LARGE: { status: 400, message: 'عدد الأصناف كبير جداً في طلب واحد.', retryable: false },
  CART_INVALID: { status: 400, message: 'في صنف غير صحيح في السلة. حدّث الصفحة.', retryable: false },
  INVALID_NAME: { status: 400, message: 'من فضلك اكتب الاسم بالكامل.', retryable: false },
  INVALID_PHONE: { status: 400, message: 'رقم الموبايل غير صحيح.', retryable: false },
  INVALID_ADDRESS: { status: 400, message: 'من فضلك اكتب عنوان التوصيل بالتفصيل.', retryable: false },
  NOTES_TOO_LONG: { status: 400, message: 'الملاحظات طويلة جداً.', retryable: false },
  GOVERNORATE_NOT_SERVED: { status: 400, message: 'المحافظة دي مش ضمن مناطق الشحن المتاحة.', retryable: false },
  AREA_INVALID: { status: 400, message: 'المنطقة مش ضمن مناطق المحافظة. اختارها تاني من القايمة.', retryable: false },
  INSTALLATION_NOT_AVAILABLE: {
    status: 409,
    message: 'فني التركيب مش متاح في المنطقة دي دلوقتي. اختار منطقة تانية أو «هركّبه بنفسي».',
    retryable: false,
  },
  INSTALLATION_NO_METERS: { status: 400, message: 'فني التركيب للأفلام بالمقاس بس — السلة مافيهاش أفلام بالمقاس.', retryable: false },
  ITEM_UNAVAILABLE: {
    status: 409,
    message: 'في صنف في السلة مش متاح أو الطول مش مسموح. حدّث الصفحة.',
    retryable: false,
  },
  CONCURRENT_SUBMIT: { status: 409, message: 'الطلب بيتسجّل بالفعل. استنى لحظة.', retryable: true },
  PHONE_DAILY_LIMIT: {
    status: 429,
    message: 'وصلت لأقصى عدد طلبات لنفس الرقم في اليوم. كلّمنا على واتساب.',
    retryable: false,
  },
  // 0019 — أكواد الخصم. رسايل عامة؛ رسالة الحد الأدنى بالرقم بتتبني في الواجهة من المعاينة (PR4).
  COUPON_INVALID: { status: 400, message: 'كود الخصم غير صحيح.', retryable: false },
  // 0021-D — موعد التسليم المفضّل (45415)
  PREFERRED_DELIVERY_INVALID: {
    status: 400,
    message: 'موعد التسليم المفضّل مش صحيح. اختار تاريخ من النهارده لحد 60 يوم، أو سيبه فاضي.',
    retryable: false,
  },
  // 0021-D2 — قراية إعداد موعد التسليم فشلت والطلب فيه موعد: مفيش طلب بيتعمل، والإعادة بنفس المفتاح والبيانات آمنة
  DELIVERY_SETTINGS_UNAVAILABLE: { status: 503, message: 'حصلت مشكلة مؤقتة، حاول تاني.', retryable: true },
  COUPON_EXPIRED: { status: 409, message: 'كود الخصم ده مش ساري دلوقتي.', retryable: false },
  COUPON_EXHAUSTED: { status: 409, message: 'كود الخصم ده خلص.', retryable: false },
  COUPON_MIN_SUBTOTAL: { status: 409, message: 'إجمالي الأصناف أقل من الحد الأدنى لكود الخصم ده.', retryable: false },
  COUPON_PHONE_LIMIT: { status: 409, message: 'كود الخصم ده اتستخدم قبل كده برقم الموبايل ده.', retryable: false },
  COUPON_NOT_APPLICABLE: { status: 409, message: 'كود الخصم ده مالوش خصم على الطلب ده.', retryable: false },
  COUPONS_DISABLED: { status: 409, message: 'أكواد الخصم مش متاحة دلوقتي. شيل الكود وكمّل طلبك.', retryable: false },
  SETTINGS_MISSING: { status: 503, message: 'في مشكلة مؤقتة في إعدادات الشحن. كلّمنا على واتساب.', retryable: true },
  PRICE_OUT_OF_RANGE: { status: 503, message: 'في مشكلة في إعدادات الأسعار. كلّمنا على واتساب.', retryable: false },
  ORDER_NUMBER_EXHAUSTED: { status: 503, message: 'مشكلة مؤقتة. جرّب تاني بعد لحظة.', retryable: true },
  INTERNAL: { status: 500, message: 'حصلت مشكلة غير متوقّعة. كلّمنا على واتساب.', retryable: true },
}

/**
 * أكواد داخلية (§1.3): التلات هاشات بيحسبهم الباك إند نفسه ومش جايين من
 * الـbody، فظهور أي واحد منهم = باگ عندنا. بيتقنّعوا كلهم لـINTERNAL، **وبدون
 * أي تمييز بينهم** — التمييز لوحده بيقول للمهاجم أي هاش بيتحسب إزاي.
 */
const INTERNAL_ONLY_CODES = new Set<string>([
  'REQUEST_HASH_INVALID',
  'SESSION_HASH_INVALID',
  'RECEIPT_HASH_INVALID',
])

function isKnownCode(value: string): value is OrderErrorCode {
  return Object.prototype.hasOwnProperty.call(ORDER_ERRORS, value)
}

/**
 * من رسالة خطأ المحرّك لكود عقد. أي حاجة مش معروفة → INTERNAL.
 * الرسالة الخام **ما بتترجعش** للعميل — بتتلوج سيرفر-سايد بس.
 */
export function codeFromSqlError(sqlMessage: string): OrderErrorCode {
  const match = /ZELL_[A-Z0-9_]+/.exec(sqlMessage)
  if (match === null) return 'INTERNAL'

  const bare = match[0].slice('ZELL_'.length)
  if (INTERNAL_ONLY_CODES.has(bare)) return 'INTERNAL'
  if (isKnownCode(bare)) return bare
  return 'INTERNAL'
}

/**
 * 0019 — أكواد zell_preview_coupon بس. أي كود تاني (حتى لو معروف لمسار الطلب) → INTERNAL،
 * لأن المعاينة مابتفحصش الموبايل ولا الحد الأدنى ومش المفروض ترجّع غير دول.
 *
 * ⚠️ 45080 ZELL_ORDER_CANCELLED_FINAL مش في العقد هنا عن قصد: بييجي من trigger تغيير حالة الأوردر
 *    في اللوحة بس، ومابيوصلش لمسار إنشاء الطلب ولا المعاينة. لو ظهر بيتقنّع INTERNAL.
 */
const PREVIEW_SQL_CODES: ReadonlyArray<CouponPreviewErrorCode> = [
  'COUPONS_DISABLED',
  'COUPON_INVALID',
  'COUPON_EXPIRED',
  'COUPON_EXHAUSTED',
]

export function previewCodeFromSqlError(sqlMessage: string): CouponPreviewErrorCode {
  const code = codeFromSqlError(sqlMessage)
  return PREVIEW_SQL_CODES.find((known) => known === code) ?? 'INTERNAL'
}

export function orderFailure(code: OrderErrorCode): OrderFailure {
  const spec = ORDER_ERRORS[code]
  return { ok: false, code, message: spec.message, retryable: spec.retryable }
}

export function statusFor(code: OrderErrorCode): number {
  return ORDER_ERRORS[code].status
}
