import type { ProductSizeEntry } from '@zell/core'

/**
 * LENGTH-INPUT — «طريقة إدخال المقاس في صفحة المنتج» في اللوحة (docs/contracts/LENGTH-INPUT.md §٢). منطق خالص.
 *
 * الحقل productSizeEntry على كائن settings.hero. القراية: 'm' بالحرف = متر، وأي حاجة تانية = 'cm' (نفس قاعدة المتجر بالحرف:
 * apps/storefront/lib/size/sizeEntry.ts). اللوحة لازم تقراه (readHero) وتكتبه دايمًا (validateHero)، وإلا بيضيع مع أول حفظ.
 * الإعداد بيحدد الطريقة اللي تظهر أولًا بس؛ الطريقتين متاحتين للعميل، ومالوش دخل بالحساب أو الأسعار.
 */

export const DEFAULT_PRODUCT_SIZE_ENTRY: ProductSizeEntry = 'cm'

/** نصوص الإعداد رسمية (فصحى مبسّطة، من غير كلام موجّه لصاحب المحل). */
export const SIZE_ENTRY_TITLE = 'طريقة إدخال المقاس في صفحة المنتج'

export const SIZE_ENTRY_OPTIONS: ReadonlyArray<{ value: ProductSizeEntry; label: string; hint: string }> = [
  { value: 'cm', label: 'مقاس المكان بالسنتيمتر (الافتراضي)', hint: 'يكتب العميل عرض المكان وارتفاعه بالسنتيمتر، ويُحسب الطول المطلوب تلقائيًا.' },
  { value: 'm', label: 'الطول بالمتر', hint: 'يختار العميل الطول المطلوب بالمتر مباشرةً.' },
]

export const SIZE_ENTRY_NOTE = 'يحدد هذا الإعداد الطريقة التي تظهر أولًا فقط، وتظل الطريقتان متاحتين للعميل. لا يؤثر على الحساب أو الأسعار.'

export const SIZE_ENTRY_INVALID = 'يُرجى اختيار طريقة إدخال المقاس: بالسنتيمتر أو بالمتر.'

/** القراية (اللوحة): 'm' بس هي متر، وأي حاجة تانية سنتيمتر. */
export function readProductSizeEntry(raw: unknown): ProductSizeEntry {
  return raw === 'm' ? 'm' : 'cm'
}

/** التحقق في السيرفر (validateHero): 'cm' أو 'm'، والغايب = 'cm'، وأي قيمة تانية = رفض. */
export function checkProductSizeEntry(raw: unknown): { ok: true; value: ProductSizeEntry } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: DEFAULT_PRODUCT_SIZE_ENTRY }
  if (raw === 'cm' || raw === 'm') return { ok: true, value: raw }
  return { ok: false, message: SIZE_ENTRY_INVALID }
}
