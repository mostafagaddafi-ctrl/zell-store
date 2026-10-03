import 'server-only'

import type { AdminProduct } from '../adminData'
import { flag, invalid, optionalText, requiredText, wholeNumber, type ValidationFailure } from './shared'

/**
 * تحقق المنتج — الحدود المعتمدة.
 *
 * حدود الفوائد (٦ عناصر · ١٤٠ حرف · مفيش فاضي) **نفس** اللي القيد
 * products_benefits_shape بيطبقه عن طريق zell_valid_benefits.
 * التطابق مقصود: الرفض لازم ييجي من هنا برسالة عربية، مش من الداتابيز
 * برسالة قيد ماينفعش تتعرض.
 */

export type ProductInput = Partial<AdminProduct> & { id?: number; expectedUpdatedAt?: string }

/** الإنشاء والتعديل مش نفس القواعد — الإظهار بالتحديد. */
export type ProductMode = 'create' | 'update'

/**
 * الأعمدة اللي اللوحة مسموح لها تكتبها — **ولا عمود غيرها**.
 *
 * ⚠️ image_url و images و before_image و after_image **مستثنيين عن قصد**.
 * دول أعمدة نظام الصور القديم، ونظام product_images هو المعتمد.
 * الكتابة فيهم كانت هتخلي مصدرين للصور بيختلفوا.
 */
export type ProductColumns = {
  name_ar: string
  name_en: string | null
  brand: string | null
  description_ar: string | null
  short_benefit: string | null
  benefits: string[]
  price_per_meter_piastres: number
  width_cm: number
  lock_width: boolean
  compare_at_piastres: number | null
  sale_unit: 'meter' | 'piece'
  is_listed: boolean
  max_quantity: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
  is_active: boolean
  sort_order: number
}

const MAX_BENEFITS = 6
const MAX_BENEFIT_LENGTH = 140

function validateBenefits(value: unknown): { ok: true; value: string[] } | ValidationFailure {
  if (value === undefined || value === null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return invalid('الفوائد لازم تكون قائمة')
  if (value.length > MAX_BENEFITS) return invalid('أقصى عدد فوائد هو ' + String(MAX_BENEFITS))

  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return invalid('كل فايدة لازم تكون نص')
    const text = item.trim()
    if (text === '') return invalid('مفيش فايدة تكون فاضية — املاها أو امسحها')
    if (text.length > MAX_BENEFIT_LENGTH) {
      return invalid('الفايدة أطول من المسموح (' + String(MAX_BENEFIT_LENGTH) + ' حرف)')
    }
    out.push(text)
  }
  return { ok: true, value: out }
}

export function validateProduct(
  input: ProductInput,
  mode: ProductMode,
): { ok: true; columns: ProductColumns } | ValidationFailure {
  const nameAr = requiredText(input.nameAr, 'اسم المنتج', 2, 120)
  if (!nameAr.ok) return nameAr

  const nameEn = optionalText(input.nameEn, 'الاسم الإنجليزي', 160)
  if (!nameEn.ok) return nameEn

  const brand = optionalText(input.brand, 'الماركة', 100)
  if (!brand.ok) return brand

  const descriptionAr = optionalText(input.descriptionAr, 'الوصف', 2000)
  if (!descriptionAr.ok) return descriptionAr

  const shortBenefit = optionalText(input.shortBenefit, 'الفايدة المختصرة', 180)
  if (!shortBenefit.ok) return shortBenefit

  const benefits = validateBenefits(input.benefits)
  if (!benefits.ok) return benefits

  const price = wholeNumber(input.pricePerMeterPiastres, 'سعر المتر')
  if (!price.ok) return price

  const width = wholeNumber(input.widthCm, 'عرض الرول')
  if (!width.ok) return width

  // 0013 — قيمة ناقصة = مش متثبّت (نفس السلوك القديم)
  const lockWidth = flag(input.lockWidth ?? false, 'تثبيت العرض')
  if (!lockWidth.ok) return lockWidth

  // 0016 — نوع البيع (ناقص = متر) · الظهور في القوايم · أقصى عدد للقطعة
  const saleUnit: 'meter' | 'piece' = input.saleUnit === 'piece' ? 'piece' : 'meter'
  const listed = flag(input.isListed ?? true, 'الظهور في القوايم')
  if (!listed.ok) return listed
  const maxQuantity = wholeNumber(input.maxQuantity ?? 20, 'أقصى عدد')
  if (!maxQuantity.ok) return maxQuantity
  if (maxQuantity.value < 1 || maxQuantity.value > 999) return invalid('أقصى عدد لازم يكون من ١ لـ ٩٩٩')

  // 0014 — فاضي أو صفر = مفيش خصم
  let compareAt: number | null = null
  const rawCompare = input.compareAtPiastres
  if (rawCompare !== undefined && rawCompare !== null && rawCompare !== 0) {
    const parsed = wholeNumber(rawCompare, 'السعر قبل الخصم')
    if (!parsed.ok) return parsed
    compareAt = parsed.value
  }

  const minLength = wholeNumber(input.minLengthCm, 'أقل طول')
  if (!minLength.ok) return minLength

  const step = wholeNumber(input.stepCm, 'خطوة الطول')
  if (!step.ok) return step

  const maxLength = wholeNumber(input.maxLengthCm, 'أقصى طول')
  if (!maxLength.ok) return maxLength

  const sortOrder = wholeNumber(input.sortOrder, 'الترتيب')
  if (!sortOrder.ok) return sortOrder

  /**
   * ⚠️ المنتج الجديد بيتولد **مخفي** دايمًا.
   *
   * قيمة isActive الجاية من الواجهة **بتتجاهل تمامًا** وقت الإنشاء.
   * السبب: المنتج وقت الإنشاء مالوش صور ولا وصف مكتمل بالضرورة،
   * ولو اتنشر فورًا الزبون بيشوف منتج ناقص في المتجر. التفعيل عملية
   * منفصلة بشروط جاهزية (شوف activationReadiness).
   */
  let isActiveValue = false
  if (mode === 'update') {
    const isActive = flag(input.isActive, 'الإظهار')
    if (!isActive.ok) return isActive
    isActiveValue = isActive.value
  }

  if (price.value <= 0) return invalid('سعر المتر لازم يكون أكبر من صفر')
  if (compareAt !== null && compareAt <= price.value) {
    return invalid('السعر قبل الخصم لازم يكون أكبر من سعر المتر — أو سيبه فاضي')
  }
  if (width.value <= 0) return invalid('عرض الرول لازم يكون أكبر من صفر')
  if (minLength.value <= 0) return invalid('أقل طول لازم يكون أكبر من صفر')
  if (step.value <= 0) return invalid('خطوة الطول لازم تكون أكبر من صفر')
  if (maxLength.value < minLength.value) return invalid('أقصى طول لازم يكون أكبر من أقل طول أو يساويه')
  if (sortOrder.value < 0) return invalid('الترتيب ماينفعش يكون سالب')

  const columns: ProductColumns = {
    name_ar: nameAr.value,
    name_en: nameEn.value,
    brand: brand.value,
    description_ar: descriptionAr.value,
    short_benefit: shortBenefit.value,
    benefits: benefits.value,
    price_per_meter_piastres: price.value,
    width_cm: width.value,
    lock_width: lockWidth.value,
    compare_at_piastres: compareAt,
    sale_unit: saleUnit,
    is_listed: listed.value,
    max_quantity: maxQuantity.value,
    min_length_cm: minLength.value,
    step_cm: step.value,
    max_length_cm: maxLength.value,
    is_active: isActiveValue,
    sort_order: sortOrder.value,
  }

  return { ok: true, columns }
}
