import type { StoreProduct } from '@zell/core'

/**
 * نصوص المنتج في المتجر — **من اللوحة بس**.
 *
 * ممنوع أي تخمين من اسم المنتج: النسخة القديمة كانت بتشوف كلمة زي «فاميه»
 * أو «عازل» في الاسم وتحط فايدة ونقط ثابتة، فمنتج زي «رول فاميه 30 متر»
 * (بيع بالجملة) كان بيظهر بكلام «مناسب للبلكونة» اللي مالوش علاقة بيه.
 *
 *   - الكارت: «الفائدة المختصرة». لو فاضية: الوصف مقصوص (نص كتبه الأدمن برضه).
 *   - صفحة المنتج: «المميزات». لو فاضية: مفيش نقط خالص.
 */

const MAX_FALLBACK_CHARS = 72

function truncate(text: string): string {
  const clean = text.trim()
  if (clean.length <= MAX_FALLBACK_CHARS) return clean
  const cut = clean.slice(0, MAX_FALLBACK_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut) + '…'
}

export function shortBenefit(product: StoreProduct): string {
  const own = (product.short_benefit ?? '').trim()
  if (own !== '') return own
  return product.description_ar ? truncate(product.description_ar) : ''
}

export function keyPoints(product: StoreProduct): string[] {
  return (product.benefits ?? []).map((point) => point.trim()).filter((point) => point !== '')
}
