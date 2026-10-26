import type { ProductSizeTextKey, ProductSizeTexts } from '@zell/core'

/**
 * SIZE-TEXTS — «نصوص حدد المقاس في صفحة المنتج» في اللوحة (docs/contracts/LENGTH-INPUT.md §SIZE-TEXTS). منطق خالص.
 *
 * الحقل productSizeTexts على كائن settings.hero. القراية بنفس قاعدة المتجر بالحرف (apps/storefront/lib/size/sizeTexts.ts).
 * اللوحة لازم تقراه (readHero) وتكتبه دايمًا (validateHero)، وإلا بيضيع مع أول حفظ لباقي المحتوى. الخانة الفاضية بتتشال،
 * والمتجر بيعرض مكانها النص الافتراضي. النصوص للعرض بس، ومالهاش دخل بالحساب أو الأسعار أو السلة.
 */

/** النصوص الافتراضية = النصوص اللي في المتجر بالحرف (بتظهر جوه الخانة الفاضية). */
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

/** أقصى طول لكل خانة — نفس حدود المتجر بالحرف. */
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

/** نصوص الإعداد رسمية (فصحى مبسّطة، من غير كلام موجّه لصاحب المحل). */
export const SIZE_TEXTS_TITLE = 'نصوص «حدد المقاس» في صفحة المنتج'

export const SIZE_TEXTS_NOTE = 'اترك الخانة فارغة لاستخدام النص الافتراضي الظاهر داخلها. هذه النصوص للعرض فقط، ولا تؤثر على حساب المقاس أو الأسعار أو السلة.'

export const SIZE_TEXTS_INVALID = 'تعذّر حفظ نصوص «حدد المقاس». حدّث الصفحة وحاول مرة أخرى.'

export type SizeTextField = { key: ProductSizeTextKey; label: string; max: number; multiline: boolean; defaultText: string }

const FIELD_SPECS: ReadonlyArray<[ProductSizeTextKey, string, boolean]> = [
  ['title', 'عنوان القسم', false],
  ['intro', 'الشرح أسفل العنوان', true],
  ['rollHint', 'شرح عرض الرول (يظهر عند وجود أكثر من عرض)', true],
  ['widthLabel', 'اسم خانة العرض', false],
  ['heightLabel', 'اسم خانة الارتفاع', false],
  ['heightExample', 'المثال أسفل خانة الارتفاع', false],
  ['guide', 'الإرشاد قبل إدخال المقاس', true],
  ['toMeters', 'رابط التحويل إلى الطول بالمتر', false],
  ['toCentimeters', 'رابط الرجوع إلى المقاس بالسنتيمتر', false],
  ['meterNote', 'ملاحظة الطول بالمتر (بعد جملة عرض الشريط التلقائية)', true],
]

export const SIZE_TEXT_FIELDS: readonly SizeTextField[] = FIELD_SPECS.map(([key, label, multiline]) => ({
  key,
  label,
  max: SIZE_TEXT_MAX[key],
  multiline,
  defaultText: DEFAULT_SIZE_TEXTS[key],
}))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** قراية الإعداد (نفس قاعدة المتجر بالحرف): الخانات الصالحة بس، وأي حاجة تانية بتتجاهل. */
export function readProductSizeTexts(raw: unknown): ProductSizeTexts {
  if (!isRecord(raw)) return {}
  const out: ProductSizeTexts = {}
  for (const field of SIZE_TEXT_FIELDS) {
    const value = raw[field.key]
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text === '' || text.length > field.max) continue
    out[field.key] = text
  }
  return out
}

/**
 * تحقق السيرفر قبل الحفظ: الغايب أو null = {} · الخانة الفاضية بتتشال · النص بيتعمله trim · الأطول من الحد مرفوض برسالة
 * (من غير قص صامت) · أي مفتاح غير معروف أو قيمة مش نص = مرفوض.
 */
export function checkProductSizeTexts(value: unknown): { ok: true; value: ProductSizeTexts } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: {} }
  if (!isRecord(value)) return { ok: false, message: SIZE_TEXTS_INVALID }
  for (const key of Object.keys(value)) {
    if (!SIZE_TEXT_FIELDS.some((field) => field.key === key)) return { ok: false, message: SIZE_TEXTS_INVALID }
  }
  const out: ProductSizeTexts = {}
  for (const field of SIZE_TEXT_FIELDS) {
    const raw = value[field.key]
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'string') return { ok: false, message: SIZE_TEXTS_INVALID }
    const text = raw.trim()
    if (text === '') continue
    if (text.length > field.max) return { ok: false, message: field.label + ' أطول من المسموح (' + String(field.max) + ' حرف)' }
    out[field.key] = text
  }
  return { ok: true, value: out }
}
