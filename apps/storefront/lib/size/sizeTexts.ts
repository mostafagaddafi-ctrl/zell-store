import type { ProductSizeTextKey, ProductSizeTexts } from '@zell/core'

/**
 * SIZE-TEXTS — نصوص «حدد المقاس» في صفحة المنتج اللي بتتعدّل من «المحتوى» في اللوحة (settings.hero.productSizeTexts).
 * منطق خالص (من غير server-only ولا أي استيراد قيمة برّه المجلد)، فحالات suite size-texts بتشغّله فعليًا.
 *
 *   • النصوص للعرض بس (React بيعرضها كنص عادي). مالهاش أي دخل بالحساب ولا الأسعار ولا السلة ولا بصمة مسودة المقاس
 *     (sizeRulesKeyOf في sizeEntry.ts).
 *   • القراية بنفس قاعدة اللوحة بالحرف (apps/admin/lib/content/sizeTexts.ts): نص بعد trim، مش فاضي، وفي حدود الطول.
 *     أي خانة غايبة أو فاضية أو غلط = النص الافتراضي (النص اللي كان مكتوب في SizePanel قبل كده بالحرف).
 *   • ثابت ومش من هنا: رسالة بيانات المنتج الناقصة · رسايل الأخطاء والحد الأدنى · الأرقام والوحدات · إرشاد المنتج اللي
 *     عرضه ثابت · جملة «الطول ده لشريط فيلم عرضه N سم.» (الرقم تلقائي، وmeterNote بييجي بعدها).
 */

export const SIZE_TEXT_KEYS: readonly ProductSizeTextKey[] = ['title', 'intro', 'rollHint', 'widthLabel', 'heightLabel', 'heightExample', 'guide', 'toMeters', 'toCentimeters', 'meterNote']

/** أقصى طول لكل خانة — نفس حدود اللوحة بالحرف. */
export const SIZE_TEXT_MAX: Readonly<Record<ProductSizeTextKey, number>> = {
  title: 40,
  intro: 200,
  rollHint: 200,
  widthLabel: 30,
  heightLabel: 30,
  heightExample: 30,
  guide: 200,
  toMeters: 60,
  toCentimeters: 60,
  meterNote: 200,
}

/** النصوص الافتراضية = النصوص اللي كانت ثابتة في SizePanel بالحرف. */
export const DEFAULT_SIZE_TEXTS: Readonly<Record<ProductSizeTextKey, string>> = {
  title: 'حدد المقاس',
  intro: 'قيس المكان اللي هيتركّب عليه الفيلم — شباك، باب، قزاز، مراية — بالسنتيمتر، وإحنا نحسب كام متر محتاج.',
  rollHint: 'ده عرض الفيلم نفسه (الشريحة الواحدة). لو المكان أعرض منه، بنقسمه شرايح.',
  widthLabel: 'عرض المكان',
  heightLabel: 'ارتفاع المكان',
  heightExample: 'مثال: 500 سم',
  guide: 'اكتب العرض والارتفاع بالسنتيمتر وإحنا نحسب عدد الشرايح والطول.',
  toMeters: 'عارف الطول اللي محتاجه بالمتر؟',
  toCentimeters: 'ارجع للمقاس بالسنتيمتر',
  meterNote: 'مش متأكد؟ ارجع للمقاس واكتبه بالسنتيمتر وإحنا نحسب.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** قراية الإعداد: الخانات الصالحة بس (نص بعد trim، مش فاضي، في حدود الطول)، وأي حاجة تانية بتتجاهل. */
export function readProductSizeTexts(raw: unknown): ProductSizeTexts {
  if (!isRecord(raw)) return {}
  const out: ProductSizeTexts = {}
  for (const key of SIZE_TEXT_KEYS) {
    const value = raw[key]
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text === '' || text.length > SIZE_TEXT_MAX[key]) continue
    out[key] = text
  }
  return out
}

/** النصوص اللي بتتعرض: الخانة المعدّلة لو موجودة، وإلا النص الافتراضي. */
export function resolveSizeTexts(overrides: ProductSizeTexts | undefined): Record<ProductSizeTextKey, string> {
  const out: Record<ProductSizeTextKey, string> = { ...DEFAULT_SIZE_TEXTS }
  if (!overrides) return out
  for (const key of SIZE_TEXT_KEYS) {
    const value = overrides[key]
    if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim()
  }
  return out
}
