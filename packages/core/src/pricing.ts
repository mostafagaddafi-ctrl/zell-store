import { isPiece, type StoreProduct } from './types'
/**
 * منطق التسعير — النسخة المرجعية الجديدة.
 *
 * ⚠️ مش النسخة الوحيدة لسه: نسختي Retool القديمتين
 * (backend/lib/pricing.ts و frontend/lib/core/pricing.ts) لسه موجودتين وشغّالتين.
 * خطة الانتقال التدريجي في docs/PHASE-1.md — ممنوع حذفهم قبل ما الداشبورد
 * يتحوّل على @zell/core ويتختبر.
 *
 * قاعدة ثابتة: ده حساب للعرض على الواجهة. الرقم المعتمد اللي بيتحصّل بيه
 * بيتحسب في الداتابيز داخل عملية ذرّية — أي سعر جاي من المتصفح بيتجاهل.
 */
import type { ProductRules } from './types'

/** أقصى مقاس شباك منطقي بالسنتيمتر — حارس ضد الإدخال الغلط. */
const MAX_WINDOW_CM = 5000

/** سقف عدد خيارات الطول في القائمة — حارس ضد قائمة ضخمة تعلّق المتصفح. */
const MAX_LENGTH_OPTIONS = 200

export type Check = { ok: true } | { ok: false; message: string }

/**
 * قواعد المنتج نفسها ممكن تكون غلط (إدخال خاطئ من اللوحة أو صف قديم).
 * كل دالة حسابية بتعدّي من هنا الأول — من غير كده step_cm بصفر بيعمل
 * modulo على صفر أو loop لا نهائي.
 */
export function validateRules(rules: Partial<ProductRules> & { width_cm?: number }): Check {
  const { price_per_meter_piastres, min_length_cm, step_cm, max_length_cm, width_cm } = rules

  const numbers = [price_per_meter_piastres, min_length_cm, step_cm, max_length_cm]
  if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return { ok: false, message: 'بيانات المنتج ناقصة أو غير صحيحة' }
  }
  if ((price_per_meter_piastres as number) <= 0) {
    return { ok: false, message: 'سعر المتر غير مضبوط لهذا المنتج' }
  }
  if ((step_cm as number) <= 0) {
    return { ok: false, message: 'خطوة الطول غير مضبوطة لهذا المنتج' }
  }
  if ((min_length_cm as number) <= 0) {
    return { ok: false, message: 'أقل طول غير مضبوط لهذا المنتج' }
  }
  if ((max_length_cm as number) < (min_length_cm as number)) {
    return { ok: false, message: 'أقصى طول أقل من الحد الأدنى لهذا المنتج' }
  }
  if (width_cm !== undefined && (!Number.isFinite(width_cm) || width_cm <= 0)) {
    return { ok: false, message: 'عرض الرول غير مضبوط لهذا المنتج' }
  }
  return { ok: true }
}

export function areRulesUsable(rules: Partial<ProductRules> & { width_cm?: number }): boolean {
  return validateRules(rules).ok
}

/** سعر القطعة = سعر المتر × الطول بالسنتيمتر ÷ ١٠٠ (تقريب لأقرب قرش). */
export function computeSubtotalPiastres(pricePerMeterPiastres: number, lengthCm: number): number {
  if (!Number.isFinite(pricePerMeterPiastres) || !Number.isFinite(lengthCm)) return 0
  if (pricePerMeterPiastres <= 0 || lengthCm <= 0) return 0
  return Math.round((pricePerMeterPiastres * lengthCm) / 100)
}

export type LengthCheck = Check

/** التحقق من الطول مقابل الحد الأدنى والخطوة — نفس القواعد المطبّقة في الداتابيز. */
export function validateLength(lengthCm: number, rules: ProductRules): LengthCheck {
  const rulesCheck = validateRules(rules)
  if (!rulesCheck.ok) return rulesCheck

  if (!Number.isInteger(lengthCm)) {
    return { ok: false, message: 'الطول لازم يكون رقم صحيح بالسنتيمتر' }
  }
  if (lengthCm < rules.min_length_cm) {
    return { ok: false, message: 'أقل طول للطلب ' + formatLength(rules.min_length_cm) }
  }
  if (lengthCm > rules.max_length_cm) {
    return { ok: false, message: 'أقصى طول للطلب ' + formatLength(rules.max_length_cm) }
  }
  // step_cm > 0 مضمون بعد validateRules
  if ((lengthCm - rules.min_length_cm) % rules.step_cm !== 0) {
    return { ok: false, message: 'الطول لازم يزيد بخطوة ' + formatLength(rules.step_cm) }
  }
  return { ok: true }
}

export type RequiredLengthResult =
  | { ok: true; lengthCm: number; strips: number; neededCm: number }
  | {
      ok: false
      code: 'invalid_rules' | 'invalid_input' | 'exceeds_max'
      message: string
      neededCm?: number
      maxLengthCm?: number
    }

/**
 * من مقاس الشباك لطول الفيلم المطلوب.
 *
 * ⚠️ مهم: الدالة دي **ما بتقصّش** المقاس الكبير للحد الأقصى.
 * النسخة القديمة كانت بتعمل Math.min(..., max_length_cm) فالزبون كان
 * ممكن يطلب طول أقل من اللي محتاجه من غير ما ياخد باله. دلوقتي بترجّع
 * فشل صريح بكود exceeds_max والواجهة بتعرض رسالة واضحة.
 */
export function requiredLength(
  windowWidthCm: number,
  windowHeightCm: number,
  rules: ProductRules & { width_cm: number },
): RequiredLengthResult {
  const rulesCheck = validateRules(rules)
  if (!rulesCheck.ok) return { ok: false, code: 'invalid_rules', message: rulesCheck.message }

  const width = Math.round(windowWidthCm)
  const height = Math.round(windowHeightCm)

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, code: 'invalid_input', message: 'اكتب عرض وارتفاع الشباك بالسنتيمتر' }
  }
  if (width > MAX_WINDOW_CM || height > MAX_WINDOW_CM) {
    return { ok: false, code: 'invalid_input', message: 'المقاس ده كبير جداً — راجع الأرقام' }
  }

  const strips = Math.ceil(width / rules.width_cm)
  const neededCm = strips * height

  let lengthCm: number
  if (neededCm <= rules.min_length_cm) {
    lengthCm = rules.min_length_cm
  } else {
    const steps = Math.ceil((neededCm - rules.min_length_cm) / rules.step_cm)
    lengthCm = rules.min_length_cm + steps * rules.step_cm
  }

  if (lengthCm > rules.max_length_cm) {
    return {
      ok: false,
      code: 'exceeds_max',
      message:
        'المقاس أكبر من الحد المتاح للطلب (' +
        formatLength(rules.max_length_cm) +
        '). كلّمنا على واتساب ونظبطهولك.',
      neededCm,
      maxLengthCm: rules.max_length_cm,
    }
  }

  return { ok: true, lengthCm, strips, neededCm }
}

/** عدد الشرايح اللي الشباك هياخدها — بنعرضها للزبون عشان يفهم الرقم جه منين. */
export function stripsForWidth(windowWidthCm: number, rollWidthCm: number): number {
  if (!Number.isFinite(windowWidthCm) || !Number.isFinite(rollWidthCm)) return 0
  if (windowWidthCm <= 0 || rollWidthCm <= 0) return 0
  return Math.ceil(windowWidthCm / rollWidthCm)
}

/**
 * كل الأطوال المسموح بيها من الحد الأدنى لحد السقف.
 * بترجّع [] لو القواعد غلط، وبتتوقف عند MAX_LENGTH_OPTIONS — من غير الحارسين
 * دول step_cm بصفر أو سالب بيعمل loop لا نهائي.
 */
export function lengthOptions(rules: ProductRules): number[] {
  if (!areRulesUsable(rules)) return []
  const out: number[] = []
  for (
    let length = rules.min_length_cm;
    length <= rules.max_length_cm && out.length < MAX_LENGTH_OPTIONS;
    length += rules.step_cm
  ) {
    out.push(length)
  }
  return out
}

/** ١٥٠ سم ← «١.٥ متر». */
export function formatLength(lengthCm: number): string {
  if (!Number.isFinite(lengthCm)) return '—'
  const meters = lengthCm / 100
  const text = Number.isInteger(meters) ? String(meters) : meters.toFixed(1)
  return text + ' متر'
}

/** ١٨٠٠٠ قرش ← «١٨٠ ج.م». */
export function formatPiastres(piastres: number): string {
  if (!Number.isFinite(piastres)) return '—'
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
  const fallback = Number.isFinite(defaultPiastres) && defaultPiastres > 0 ? defaultPiastres : 0
  if (freeThresholdPiastres > 0 && subtotalPiastres >= freeThresholdPiastres) return 0
  const rate = rates[governorate]
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 ? rate : fallback
}

// ── سطر السلة (0016) ──────────────────────────────────────────
/** إجمالي سطر — نفس zell_create_order: المتر round(السعر × الطول ÷ ١٠٠)، القطعة السعر × العدد. */
export function lineTotalPiastres(product: StoreProduct, line: { lengthCm: number; quantity?: number }): number {
  if (isPiece(product)) {
    const quantity = line.quantity ?? 0
    return quantity > 0 && product.price_per_meter_piastres > 0 ? product.price_per_meter_piastres * quantity : 0
  }
  return computeSubtotalPiastres(product.price_per_meter_piastres, line.lengthCm)
}

/** وصف السطر للزبون: «٣ متر» أو «الكمية ٢». عرض بس — مش داخل في الهاش ولا الحساب. */
export function describeLine(product: StoreProduct, line: { lengthCm: number; quantity?: number }): string {
  return isPiece(product) ? 'الكمية ' + String(line.quantity ?? 1) : formatLength(line.lengthCm)
}

/** مواصفة واحدة في سطر السلة: «الطول» · «عرض الرول» · «الكمية». */
export type LineSpec = { label: string; value: string }

/**
 * مواصفات السطر للعرض في السلة وCheckout — نفس الكلمات في المكانين.
 *   فيلم المقاس → الطول (بنفس formatLength) + عرض الرول
 *   منتج بالعدد → الكمية
 * ⚠️ product لازم يكون بعد resolveCartLine، فعرض الرول = width_cm بتاعه (العرض المختار في السطر).
 *    ده عرض الرول نفسه، مش عرض المكان. من القيم المحفوظة في السطر بس — عرض، مش داخل في الهاش ولا الحساب.
 */
export function lineSpecs(product: StoreProduct, line: { lengthCm: number; quantity?: number }): LineSpec[] {
  if (isPiece(product)) return [{ label: 'الكمية', value: String(line.quantity ?? 1) }]
  return [
    { label: 'الطول', value: formatLength(line.lengthCm) },
    { label: 'عرض الرول', value: String(product.width_cm) + ' سم' },
  ]
}
