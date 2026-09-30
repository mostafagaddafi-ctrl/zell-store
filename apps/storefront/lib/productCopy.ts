import type { StoreProduct } from '@zell/core'

/**
 * نص العرض القصير لكارت المنتج.
 *
 * دي **صياغة مختصرة للوصف الموجود في الداتابيز** — مفيش أي ادعاء جديد
 * عن الخامة ولا عن الماركة ولا عن الأداء. لو المنتج مش معروف، بنقص
 * الوصف الأصلي عند أقرب مسافة.
 *
 * مؤقت: لما الداشبورد يضيف عمود للفائدة القصيرة، الملف ده يتشال
 * والنص ييجي من الداتابيز زي أي محتوى تاني.
 */

const MAX_FALLBACK_CHARS = 72

function matches(product: StoreProduct, needles: string[]): boolean {
  const text = (product.name_ar + ' ' + (product.name_en ?? '')).toLowerCase()
  return needles.some((needle) => text.includes(needle))
}

function truncate(text: string): string {
  const clean = text.trim()
  if (clean.length <= MAX_FALLBACK_CHARS) return clean
  const cut = clean.slice(0, MAX_FALLBACK_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut) + '…'
}

export function shortBenefit(product: StoreProduct): string {
  if (matches(product, ['مصنفر', 'مطفي', 'frost'])) return 'خصوصية كاملة والنور بيدخل عادي'
  if (matches(product, ['فاميه', 'أسود', 'smoke'])) return 'تعتيم قوي وخصوصية من بره'
  if (matches(product, ['عازل', 'حرار', 'heat'])) return 'بيقلل الحرارة والوهج والرؤية تفضل واضحة'
  return product.description_ar ? truncate(product.description_ar) : ''
}
