/**
 * حالة ظهور القسم للزباين — مصدر واحد للقائمة والمحرّر.
 *
 * نفس قواعد المتجر (toStoreCollections) بالظبط:
 *   المفتاحين مقفولين       -> مخفي
 *   مفيش منتجات             -> مش ظاهر
 *   كل المنتجات متوقفة      -> مش ظاهر
 *   غير كده                 -> ظاهر في الأماكن المفعّلة
 *
 * الملف ده مالوش أي I/O — بيتحمّل في المتصفح عادي.
 */

export type VisibilityTone = 'ok' | 'warn' | 'muted'

export type CollectionVisibility = {
  tone: VisibilityTone
  label: string
  detail: string
}

export const VISIBILITY_TONE: Record<VisibilityTone, string> = {
  ok: 'text-ok',
  warn: 'text-gold',
  muted: 'text-muted',
}

export function collectionVisibility(input: {
  showOnHome: boolean
  showInNav: boolean
  productCount: number
  activeProductCount: number
}): CollectionVisibility {
  if (!input.showOnHome && !input.showInNav) {
    return { tone: 'muted', label: 'مخفي', detail: 'مقفول في الرئيسية والقائمة، فمش ظاهر للزباين.' }
  }
  if (input.productCount === 0) {
    return { tone: 'warn', label: 'مش ظاهر', detail: 'مفيش منتجات في القسم — هيظهر أول ما تضيف منتج.' }
  }
  if (input.activeProductCount === 0) {
    return {
      tone: 'warn',
      label: 'مش ظاهر',
      detail: 'كل منتجات القسم متوقفة — هيظهر أول ما منتج منهم يتفعّل.',
    }
  }
  const places: string[] = []
  if (input.showOnHome) places.push('الرئيسية')
  if (input.showInNav) places.push('القائمة وصفحة القسم')
  return { tone: 'ok', label: 'ظاهر', detail: 'ظاهر في ' + places.join(' و') + '.' }
}
