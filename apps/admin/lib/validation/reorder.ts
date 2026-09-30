import 'server-only'

import { validateImageId } from './image'
import { invalid, wholeNumber, type ValidationFailure } from './shared'

/**
 * تحقق الترتيب.
 *
 * الفحص هنا بيغطي الشكل بس: قائمة مش فاضية، معرّفات صالحة، مفيش
 * تكرار. أما إن المجموعة **تساوي** كل العناصر الموجودة فبيتفحص في
 * طبقة التعديل (مرآة لفحص الدالة) وفي الدالة نفسها.
 */

const MAX_ITEMS = 500

export function validateProductOrder(value: unknown): { ok: true; value: number[] } | ValidationFailure {
  if (!Array.isArray(value)) return invalid('الترتيب لازم يكون قائمة')
  if (value.length === 0) return invalid('الترتيب مايكونش فاضي')
  if (value.length > MAX_ITEMS) return invalid('الترتيب أطول من المسموح')

  const seen = new Set<number>()
  const out: number[] = []
  for (const item of value) {
    const id = wholeNumber(item, 'معرّف المنتج')
    if (!id.ok) return id
    if (id.value <= 0) return invalid('معرّف المنتج غير صالح')
    if (seen.has(id.value)) return invalid('في معرّف منتج مكرر في الترتيب')
    seen.add(id.value)
    out.push(id.value)
  }
  return { ok: true, value: out }
}

/** معرّفات الصور **نصوص** — bigint مايمرش كـ Number. */
export function validateImageOrder(value: unknown): { ok: true; value: string[] } | ValidationFailure {
  if (!Array.isArray(value)) return invalid('الترتيب لازم يكون قائمة')
  if (value.length === 0) return invalid('الترتيب مايكونش فاضي')
  if (value.length > MAX_ITEMS) return invalid('الترتيب أطول من المسموح')

  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const id = validateImageId(item)
    if (!id.ok) return id
    if (seen.has(id.value)) return invalid('في معرّف صورة مكرر في الترتيب')
    seen.add(id.value)
    out.push(id.value)
  }
  return { ok: true, value: out }
}
