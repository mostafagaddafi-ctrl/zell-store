/**
 * أكواد الخصم في المتجر (0019) — منطق خالص (مفيش server-only ولا متغيرات بيئة)،
 * مشترك بين راوت الطلب وصفحة الإيصال وإشعار تيليجرام.
 *
 * 🔒 ثوابت:
 *   • المتصفح بيبعت الكود بس. مفيش أي مبلغ خصم جاي من المتصفح بيتقري أصلًا.
 *   • المبلغ المعروض في الإيصال وتيليجرام ورد الطلب = لقطة الداتابيز كما هي (discount_piastres)،
 *     ومابيتحسبش تاني هنا — ولا على الـreplay.
 *
 * 🔒 قفل الكود بعد خطأ شبكة — عقد لـPR4 (Checkout)، من غير أي state هنا:
 *   الكود جزء من canonical (['c1', CODE])، فتغييره أو شيله = مفتاح idempotency جديد = نية جديدة.
 *   لو إرسال وصل الداتابيز واتسجّل وضاع رده، تغيير الكود بعده بيعمل أوردر تاني بدل replay.
 *   فالواجهة لازم تقفل تغيير الكود وشيله لما الإرسال يخلص بنتيجة «مش محسومة»:
 *     • fetch رمى (غير AbortError) أو الرد مش عقد مفهوم.
 *     • أو OrderFailure بـretryable = true (زي INTERNAL عند مهلة الـrpc، أو CONCURRENT_SUBMIT).
 *   والقفل يتفك بس لما إرسال بنفس canonical (نفس المفتاح من resolveIdempotencyKey) يرجّع:
 *     • نجاح (جديد أو replay) — الأوردر اتسجّل.
 *     • أو OrderFailure بـretryable = false — رفض واضح، ومفيش أوردر بالمفتاح ده.
 *   نقطة الربط: الـcatch وفرع isOrderFailure في submit() في CheckoutForm.tsx.
 *   من غير كود خصم مفيش قفل، وسلوك Checkout الحالي زي ما هو.
 */

import { normalizeCouponCode } from '@zell/core'

export type CouponFieldResult = { ok: true; code: string | null } | { ok: false }

/**
 * couponCode في body الطلب:
 *   ناقص · null · فاضي بعد NFC + trim → مفيش كوبون.
 *   مش نص · شكل غير صالح (عربي · مسافة جوه · قصير · طويل) → مرفوض (COUPON_INVALID).
 */
export function parseCouponCodeField(raw: unknown): CouponFieldResult {
  if (raw === undefined || raw === null) return { ok: true, code: null }
  if (typeof raw !== 'string') return { ok: false }
  if (raw.normalize('NFC').trim() === '') return { ok: true, code: null }
  const code = normalizeCouponCode(raw)
  return code === null ? { ok: false } : { ok: true, code }
}

export type DiscountLine = { code: string; piastres: number }

/** علامة الطرح في سطر الخصم (U+2212). */
export const DISCOUNT_SIGN = '\u2212'

/**
 * سطر الخصم من لقطة الأوردر. null = مفيش سطر خالص — الأوردر القديم أو من غير كوبون
 * بيتعرض زي ما هو بالظبط.
 */
export function discountLine(code: unknown, piastres: unknown): DiscountLine | null {
  if (typeof code !== 'string' || code === '') return null
  if (typeof piastres !== 'number' || !Number.isSafeInteger(piastres) || piastres < 1) return null
  return { code, piastres }
}

/** «خصم (CODE)» — نفس العنوان في الإيصال وتيليجرام. */
export function discountLabel(code: string): string {
  return 'خصم (' + code + ')'
}
