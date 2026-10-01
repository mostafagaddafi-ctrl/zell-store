import 'server-only'

import { invalid, optionalText, requiredText, timestamp, flag, type ValidationFailure } from './shared'

/**
 * تحقق المجموعات.
 *
 * ⚠️ الـslug بيظهر في URL، فالشكل مقيّد: حروف لاتينية صغيرة وأرقام
 *    وشرطات بس. القيد نفسه موجود في الداتابيز (0010)، والفحص هنا
 *    عشان الرسالة تبقى مفهومة بالعربي بدل خطأ قيد.
 *
 * ⚠️ **مفيش توليد تلقائي للـslug من العنوان العربي.** التحويل الصوتي
 *    بيطلع نتايج غريبة، والـslug بيدخل في روابط دايمة — فالأدمن
 *    بيكتبه بنفسه ويشوفه قبل الحفظ.
 */

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_PRODUCTS = 200

export type CollectionInput = {
  id?: string
  slug: unknown
  title: unknown
  subtitle: unknown
  isVisible: unknown
  expectedUpdatedAt?: unknown
}

export type CollectionPayload = {
  slug: string
  title: string
  subtitle: string | null
  isVisible: boolean
}

export function validateSlug(value: unknown): { ok: true; value: string } | ValidationFailure {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === '') return invalid('الرابط المختصر مطلوب')
  if (text.length < 2) return invalid('الرابط المختصر لازم يكون حرفين على الأقل')
  if (text.length > 60) return invalid('الرابط المختصر أطول من المسموح (٦٠ حرف)')
  if (!SLUG_PATTERN.test(text)) {
    return invalid('الرابط المختصر: حروف إنجليزي صغيرة وأرقام وشرطات بس، وماينفعش يبدأ أو ينتهي بشرطة')
  }
  return { ok: true, value: text }
}

export function validateCollection(
  input: CollectionInput,
): { ok: true; payload: CollectionPayload } | ValidationFailure {
  const slug = validateSlug(input.slug)
  if (!slug.ok) return slug

  const title = requiredText(input.title, 'عنوان المجموعة', 2, 80)
  if (!title.ok) return title

  const subtitle = optionalText(input.subtitle, 'وصف المجموعة', 200)
  if (!subtitle.ok) return subtitle

  const isVisible = flag(input.isVisible, 'إظهار المجموعة')
  if (!isVisible.ok) return isVisible

  return {
    ok: true,
    payload: {
      slug: slug.value,
      title: title.value,
      subtitle: subtitle.value,
      isVisible: isVisible.value,
    },
  }
}

export function validateExpectedUpdatedAt(value: unknown): { ok: true; value: string } | ValidationFailure {
  return timestamp(value, 'طابع المجموعة')
}

export function validateCollectionId(value: unknown): { ok: true; value: string } | ValidationFailure {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
  if (!/^[0-9]+$/.test(text)) return invalid('معرّف المجموعة غير صالح')
  return { ok: true, value: text }
}

/**
 * قائمة معرّفات المنتجات. أرقام صحيحة، بلا تكرار.
 * القائمة الفاضية **مسموحة** — مجموعة من غير منتجات حالة شغّالة
 * (الأدمن بيعملها قبل ما يربط)، والمتجر بيخفيها لوحده.
 */
export function validateProductIds(value: unknown): { ok: true; value: number[] } | ValidationFailure {
  if (!Array.isArray(value)) return invalid('قائمة المنتجات غير صالحة')
  if (value.length > MAX_PRODUCTS) return invalid('أقصى عدد منتجات في المجموعة هو ' + String(MAX_PRODUCTS))

  const out: number[] = []
  const seen = new Set<number>()
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0) {
      return invalid('قائمة المنتجات فيها معرّف غير صالح')
    }
    if (seen.has(item)) return invalid('في منتج مكرر في القائمة')
    seen.add(item)
    out.push(item)
  }
  return { ok: true, value: out }
}

export function validateCollectionOrder(value: unknown): { ok: true; value: string[] } | ValidationFailure {
  if (!Array.isArray(value) || value.length === 0) return invalid('الترتيب غير صالح')
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const id = validateCollectionId(item)
    if (!id.ok) return id
    if (seen.has(id.value)) return invalid('في مجموعة مكررة في الترتيب')
    seen.add(id.value)
    out.push(id.value)
  }
  return { ok: true, value: out }
}
