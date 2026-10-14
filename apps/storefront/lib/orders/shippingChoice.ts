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
 * EXPRESS-SHIPPING W2 — اختيار «شحن عادي / شحن سريع» في Checkout (العقد §٢-٤). منطق خالص (من غير I/O).
 *
 * 🔒 القرار:
 *   • الاختيار بيظهر بس لو الإعداد مقروء والسريع متاح لمحافظة العميل (expressOffer = نفس شرط الداتابيز).
 *     القراية فشلت = الاختيار مايظهرش والطلب عادي (من غير أي حاجز).
 *   • العميل اختار «شحن سريع» والمحافظة اتغيّرت لمحافظة مالهاش سريع = مفيش تحويل صامت: رسالة واضحة والتأكيد
 *     مقفول لحد ما يختار «شحن عادي» بنفسه.
 *   • السريع = سعره الكامل دايمًا (من غير الحد المجاني). العادي = نفس الحساب القديم بالحرف.
 *   • الـ body: shippingMethod: 'express' لو سريع بس — من غيره الـ body القديم بالحرف (ونفس الهاش).
 */

export type ShippingChoiceView = {
  /** السريع متاح للمحافظة دي (null = الاختيار مايظهرش). */
  offer: ExpressOffer | null
  /** مدة العادي لو متحددة. */
  standardDays: ShippingDays | null
  /** الطريقة اللي هتتبعت فعلًا. */
  method: ShippingMethod
  /** العميل اختار سريع والمحافظة الحالية مالهاش سريع — التأكيد مقفول لحد ما يختار عادي. */
  stranded: boolean
  /** الشحن للعرض (null = المحافظة لسه مش متحددة). */
  shippingPiastres: number | null
}

/** input = null لو المحافظة لسه مش متحددة. options = null لو القراية فشلت. */
export function shippingChoiceView(chosen: ShippingMethod, input: ShippingQuoteInput | null, options: ShippingOptions | null): ShippingChoiceView {
  if (input === null || input.governorate === '') {
    return { offer: null, standardDays: null, method: 'standard', stranded: false, shippingPiastres: null }
  }
  const offer = expressOffer(options, input.governorate)
  const standardDays = standardShippingDays(options, input.governorate)
  const method: ShippingMethod = chosen === 'express' && offer !== null ? 'express' : 'standard'
  const stranded = chosen === 'express' && offer === null && options !== null
  return { offer, standardDays, method, stranded, shippingPiastres: shippingForMethod(method, input, options) }
}

/** الحقل في body /api/orders — بس لو سريع. */
export function shippingPayloadField(method: ShippingMethod): { shippingMethod?: 'express' } {
  return method === 'express' ? { shippingMethod: 'express' } : {}
}

/** اسم سطر الشحن في الملخص. */
export function shippingSummaryLabel(view: ShippingChoiceView): string {
  if (view.offer === null) return 'الشحن'
  return view.method === 'express' ? 'الشحن السريع' : 'الشحن العادي'
}

export function strandedNotice(governorate: string): string {
  return 'الشحن السريع مش متاح لـ' + governorate + ' دلوقتي. اختار «شحن عادي» علشان تكمّل الطلب.'
}

/** المسودة بتحفظ الاختيار بس (مفيش سعر): ناقص = عادي · 'express' = سريع · أي قيمة تانية = المسودة كلها بتتجاهل. */
export function parseDraftShippingMethod(value: unknown): { ok: true; method: 'express' | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, method: undefined }
  if (value === 'express') return { ok: true, method: 'express' }
  return { ok: false }
}
