/**
 * منطق التسعير — النسخة الوحيدة في المشروع.
 * كان متكرر قبل كده في backend/lib/pricing.ts و frontend/lib/core/pricing.ts
 * والنسختين كانوا اتفرّقوا فعلاً. أي تعديل هنا بس.
 *
 * تنبيه: ده للعرض على الواجهة. الرقم المعتمد اللي بيتحصّل بيه بيتحسب في
 * الداتابيز داخل عملية ذرّية — أي سعر جاي من المتصفح بيتجاهل.
 */
import type { ProductRules } from './types'

/** سعر القطعة = سعر المتر × الطول بالسنتيمتر ÷ ١٠٠ (تقريب لأقرب قرش). */
export function computeSubtotalPiastres(pricePerMeterPiastres: number, lengthCm: number): number {
  return Math.round((pricePerMeterPiastres * lengthCm) / 100)
}

export type LengthCheck = { ok: true } | { ok: false; message: string }

/** التحقق من الطول مقابل الحد الأدنى والخطوة — نفس القواعد المطبّقة في الداتابيز. */
export function validateLength(lengthCm: number, rules: ProductRules): LengthCheck {
  if (!Number.isInteger(lengthCm)) {
    return { ok: false, message: 'الطول لازم يكون رقم صحيح بالسنتيمتر' }
  }
  if (lengthCm < rules.min_length_cm) {
    return { ok: false, message: 'أقل طول للطلب ' + formatLength(rules.min_length_cm) }
  }
  if (lengthCm > rules.max_length_cm) {
    return { ok: false, message: 'أقصى طول للطلب ' + formatLength(rules.max_length_cm) }
  }
  if ((lengthCm - rules.min_length_cm) % rules.step_cm !== 0) {
    return { ok: false, message: 'الطول لازم يزيد بخطوة ' + formatLength(rules.step_cm) }
  }
  return { ok: true }
}

/**
 * من مقاس الشباك لطول الفيلم المطلوب.
 * الفيلم بيتباع برول عرضه ثابت، فبنحسب عدد الشرايح ثم الطول الكلي،
 * ونقرّب لأعلى للحد الأدنى والخطوة المسموح بيهم.
 */
export function requiredLengthCm(
  windowWidthCm: number,
  windowHeightCm: number,
  rules: ProductRules & { width_cm: number },
): number {
  if (windowWidthCm <= 0 || windowHeightCm <= 0) return rules.min_length_cm
  const strips = Math.ceil(windowWidthCm / rules.width_cm)
  const needed = strips * windowHeightCm
  if (needed <= rules.min_length_cm) return rules.min_length_cm
  const steps = Math.ceil((needed - rules.min_length_cm) / rules.step_cm)
  return Math.min(rules.min_length_cm + steps * rules.step_cm, rules.max_length_cm)
}

/** عدد الشرايح اللي الشباك هياخدها — بنعرضها للزبون عشان يفهم الرقم جه منين. */
export function stripsForWidth(windowWidthCm: number, rollWidthCm: number): number {
  if (windowWidthCm <= 0 || rollWidthCm <= 0) return 0
  return Math.ceil(windowWidthCm / rollWidthCm)
}

/** كل الأطوال المسموح بيها من الحد الأدنى لحد السقف. */
export function lengthOptions(rules: ProductRules): number[] {
  const out: number[] = []
  for (let l = rules.min_length_cm; l <= rules.max_length_cm; l += rules.step_cm) out.push(l)
  return out
}

/** ١٥٠ سم ← «١.٥ متر». */
export function formatLength(lengthCm: number): string {
  const meters = lengthCm / 100
  const text = Number.isInteger(meters) ? String(meters) : meters.toFixed(1)
  return text + ' متر'
}

/** ١٨٠٠٠ قرش ← «١٨٠ ج.م». */
export function formatPiastres(piastres: number): string {
  const pounds = piastres / 100
  const text = Number.isInteger(pounds)
    ? pounds.toLocaleString('en-US')
    : pounds.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return text + ' ج.م'
}

/** حساب الشحن على الواجهة للعرض فقط — الرقم المعتمد بيتحسب في الداتابيز. */
export function computeShippingPiastres(
  governorate: string,
  subtotalPiastres: number,
  rates: Record<string, number>,
  defaultPiastres: number,
  freeThresholdPiastres: number,
): number {
  if (freeThresholdPiastres > 0 && subtotalPiastres >= freeThresholdPiastres) return 0
  const rate = rates[governorate]
  return typeof rate === 'number' ? rate : defaultPiastres
}
