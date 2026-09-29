/**
 * منطق التسعير والتحقق — TypeScript صافي بدون أي اعتماد على المنصّة.
 * قابل للنقل كما هو لأي مشروع Next.js / Vercel.
 *
 * قواعد ثابتة: الفلوس بالقرش (integer)، الأطوال بالسنتيمتر (integer).
 */

export type ProductRules = {
  price_per_meter_piastres: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
}

/** سعر القطعة = سعر المتر × الطول بالسنتيمتر ÷ ١٠٠ (تقريب لأقرب قرش). */
export function computeSubtotalPiastres(pricePerMeterPiastres: number, lengthCm: number): number {
  return Math.round((pricePerMeterPiastres * lengthCm) / 100)
}

export type LengthCheck = { ok: true } | { ok: false; message: string }

/** التحقق من الطول مقابل الحد الأدنى والخطوة — نفس القواعد المطبّقة في الداتابيز. */
export function validateLength(lengthCm: number, rules: ProductRules): LengthCheck {
  if (!Number.isInteger(lengthCm)) return { ok: false, message: 'الطول لازم يكون رقم صحيح بالسنتيمتر' }
  if (lengthCm < rules.min_length_cm) {
    return { ok: false, message: `أقل طول للطلب ${formatLength(rules.min_length_cm)}` }
  }
  if (lengthCm > rules.max_length_cm) {
    return { ok: false, message: `أقصى طول للطلب ${formatLength(rules.max_length_cm)}` }
  }
  if ((lengthCm - rules.min_length_cm) % rules.step_cm !== 0) {
    return { ok: false, message: `الطول لازم يزيد بخطوة ${formatLength(rules.step_cm)}` }
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

/** كل الأطوال المسموح بيها من الحد الأدنى لحد السقف. */
export function lengthOptions(rules: ProductRules): number[] {
  const out: number[] = []
  for (let l = rules.min_length_cm; l <= rules.max_length_cm; l += rules.step_cm) out.push(l)
  return out
}

/** ١٥٠ سم → «١.٥ متر». */
export function formatLength(lengthCm: number): string {
  const meters = lengthCm / 100
  const text = Number.isInteger(meters) ? String(meters) : meters.toFixed(1)
  return `${text} متر`
}

/** ١٨٠٠٠ قرش → «١٨٠ ج.م». */
export function formatPiastres(piastres: number): string {
  const pounds = piastres / 100
  const text = Number.isInteger(pounds)
    ? pounds.toLocaleString('en-US')
    : pounds.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${text} ج.م`
}

/** تنظيف رقم الموبايل المصري: أرقام لاتينية فقط بصيغة 01XXXXXXXXX. */
export function normalizePhone(raw: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
  let digits = ''
  for (const ch of raw.trim()) {
    const ai = arabicDigits.indexOf(ch)
    if (ai >= 0) digits += String(ai)
    else if (ch >= '0' && ch <= '9') digits += ch
  }
  if (digits.startsWith('0020')) digits = digits.slice(4)
  else if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2)
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`
  return digits
}

export function isValidEgyptianPhone(raw: string): boolean {
  const p = normalizePhone(raw)
  return /^01[0125][0-9]{8}$/.test(p)
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
