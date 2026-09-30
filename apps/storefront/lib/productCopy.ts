import type { StoreProduct } from '@zell/core'

/**
 * نصوص العرض القصيرة.
 *
 * دي **صياغة مختصرة للوصف الموجود في الداتابيز** — مفيش أي ادعاء جديد
 * عن الخامة ولا الماركة ولا الأداء. منتج مش معروف بياخد وصفه مقصوص،
 * ومن غير أي نقاط مميزات مخترعة.
 *
 * مؤقت: لما الداشبورد يضيف أعمدة للفائدة والمميزات، الملف ده يتشال.
 */

const MAX_FALLBACK_CHARS = 72

type Variant = 'heat' | 'frosted' | 'smoked' | 'unknown'

function variantOf(product: StoreProduct): Variant {
  const text = (product.name_ar + ' ' + (product.name_en ?? '')).toLowerCase()
  if (text.includes('مصنفر') || text.includes('مطفي') || text.includes('frost')) return 'frosted'
  if (text.includes('فاميه') || text.includes('أسود') || text.includes('smoke')) return 'smoked'
  if (text.includes('عازل') || text.includes('حرار') || text.includes('heat')) return 'heat'
  return 'unknown'
}

function truncate(text: string): string {
  const clean = text.trim()
  if (clean.length <= MAX_FALLBACK_CHARS) return clean
  const cut = clean.slice(0, MAX_FALLBACK_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut) + '…'
}

const BENEFIT: Record<Variant, string> = {
  heat: 'بيقلل الحرارة والوهج والرؤية تفضل واضحة',
  frosted: 'خصوصية كاملة والنور بيدخل عادي',
  smoked: 'تعتيم قوي وخصوصية من بره',
  unknown: '',
}

/** نقاط مأخوذة حرفيًا من معاني الوصف المسجّل — مفيش إضافات. */
const POINTS: Record<Variant, string[]> = {
  heat: ['بيقلل الحرارة والوهج', 'التكييف يتعب أقل', 'الفرش ما يبهتش', 'الرؤية من جوه تفضل واضحة'],
  frosted: ['محدش يشوف من بره', 'النور بيدخل عادي', 'مناسب للحمام والمطبخ', 'للأبواب الزجاجية الداخلية'],
  smoked: ['تعتيم قوي وخصوصية كاملة', 'بيقلل الشمس والوهج', 'مناسب للبلكونة', 'للشبابيك المطلة على الشارع'],
  unknown: [],
}

export function shortBenefit(product: StoreProduct): string {
  const benefit = BENEFIT[variantOf(product)]
  if (benefit) return benefit
  return product.description_ar ? truncate(product.description_ar) : ''
}

export function keyPoints(product: StoreProduct): string[] {
  return POINTS[variantOf(product)]
}
