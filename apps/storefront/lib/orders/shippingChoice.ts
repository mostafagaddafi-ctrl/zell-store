import {
  expressOffer,
  shippingForMethod,
  standardShippingDays,
  type ExpressOffer,
  type ShippingDays,
  type ShippingMethod,
  type ShippingOptions,
  type ShippingQuoteInput,
} from '@zell/core'

/**
 * EXPRESS-SHIPPING W2 — اختيار «شحن عادي / شحن سريع» في Checkout (العقد §٢-٤ و§٧-٣). منطق خالص (من غير I/O).
 *
 * 🔒 القرار:
 *   • الاختيار بيظهر بس لو الإعداد مقروء والسريع متاح لمحافظة العميل (expressOffer = نفس شرط الداتابيز).
 *   • العميل على «شحن عادي» (الافتراضي) والقراية فشلت = الاختيار مخفي والطلب عادي زي ما هو، من غير أي حاجز.
 *   • العميل اختار «شحن سريع» (بنفسه أو من المسودة) والسريع مش متاح دلوقتي = **مفيش تحويل صامت لعادي**: اختياره بيفضل،
 *     والإرسال مقفول، ورسالة واضحة:
 *       - القراية فشلت ('unread')  → «إعادة تحميل الإعداد» أو «المتابعة بشحن عادي».
 *       - المحافظة مالهاش سريع ('unavailable') → «المتابعة بشحن عادي».
 *     الطلب العادي مابيتبعتش غير بعد ما العميل يختار «شحن عادي» بنفسه (shippingSubmitField = null طول ما الاختيار مقفول،
 *     فمفيش canonical ولا مفتاح idempotency بيتولّد).
 *   • السريع = سعره الكامل دايمًا (من غير الحد المجاني). العادي = نفس الحساب القديم بالحرف.
 *   • الـ body: shippingMethod: 'express' لو سريع بس — من غيره الـ body القديم بالحرف (ونفس الهاش).
 */

export type ShippingBlock = 'unread' | 'unavailable'

export type ShippingChoiceView = {
  /** السريع متاح للمحافظة دي (null = الاختيار مايظهرش). */
  offer: ExpressOffer | null
  /** مدة العادي لو متحددة. */
  standardDays: ShippingDays | null
  /** الطريقة للعرض والإرسال لما الاختيار مش مقفول. */
  method: ShippingMethod
  /** سبب قفل الإرسال: العميل اختار سريع والسريع مش متاح دلوقتي (null = مفيش قفل). */
  blocked: ShippingBlock | null
  /** = blocked !== null. */
  stranded: boolean
  /** الشحن للعرض (null = المحافظة لسه مش متحددة). */
  shippingPiastres: number | null
}

export const SHIPPING_CHOICE_TEXT = {
  unread: 'تعذّر تحميل إعداد الشحن السريع دلوقتي، واختيارك «شحن سريع» لسه زي ما هو. أعد تحميل الإعداد، أو كمّل بشحن عادي لو تحب.',
  reload: 'إعادة تحميل الإعداد',
  continueStandard: 'المتابعة بشحن عادي',
} as const

/** input = null لو المحافظة لسه مش متحددة. options = null لو القراية فشلت. */
export function shippingChoiceView(chosen: ShippingMethod, input: ShippingQuoteInput | null, options: ShippingOptions | null): ShippingChoiceView {
  if (input === null || input.governorate === '') {
    return { offer: null, standardDays: null, method: 'standard', blocked: null, stranded: false, shippingPiastres: null }
  }
  const offer = expressOffer(options, input.governorate)
  const standardDays = standardShippingDays(options, input.governorate)
  const method: ShippingMethod = chosen === 'express' && offer !== null ? 'express' : 'standard'
  const blocked: ShippingBlock | null = chosen === 'express' && offer === null ? (options === null ? 'unread' : 'unavailable') : null
  return { offer, standardDays, method, blocked, stranded: blocked !== null, shippingPiastres: shippingForMethod(method, input, options) }
}

/** الحقل في body /api/orders — بس لو سريع. */
export function shippingPayloadField(method: ShippingMethod): { shippingMethod?: 'express' } {
  return method === 'express' ? { shippingMethod: 'express' } : {}
}

/**
 * الحقل وقت الإرسال، أو null لو الاختيار مقفول (سريع مختار ومش متاح) — ساعتها مفيش إرسال ولا canonical ولا مفتاح جديد.
 * المحافظة لسه مش متحددة بيتمسك في التحقق العادي للفورم.
 */
export function shippingSubmitField(view: ShippingChoiceView): { shippingMethod?: 'express' } | null {
  return view.blocked !== null ? null : shippingPayloadField(view.method)
}

/** اسم سطر الشحن في الملخص. */
export function shippingSummaryLabel(view: ShippingChoiceView): string {
  if (view.offer === null) return 'الشحن'
  return view.method === 'express' ? 'الشحن السريع' : 'الشحن العادي'
}

export function strandedNotice(governorate: string): string {
  return 'الشحن السريع مش متاح لـ' + governorate + ' دلوقتي، واختيارك «شحن سريع» لسه زي ما هو. اختار «المتابعة بشحن عادي» علشان تكمّل الطلب.'
}

/** المسودة بتحفظ الاختيار بس (مفيش سعر): ناقص = عادي · 'express' = سريع · أي قيمة تانية = المسودة كلها بتتجاهل. */
export function parseDraftShippingMethod(value: unknown): { ok: true; method: 'express' | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, method: undefined }
  if (value === 'express') return { ok: true, method: 'express' }
  return { ok: false }
}
