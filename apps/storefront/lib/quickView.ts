import { discountInfo, galleryImages, type StoreProduct } from '@zell/core'
import { keyPoints } from './productCopy'

/**
 * بيانات نافذة المنتج السريعة (ProductQuickView) — عرض بس.
 *
 * نفس مصادر صفحة المنتج بالظبط: الاسم · صور المعرض بالترتيب · السعر والخصم (discountInfo) ·
 * الوصف · «المميزات» (keyPoints). مفيش تسعير جديد — zell_create_order بتسعّر من الداتابيز.
 * خالصة (من غير React)، فبتتنادى من السيرفر (صفحة «أدوات التركيب») ومن المتصفح (كارت الإضافات).
 */
export type QuickView = {
  name: string
  nameEn: string
  images: Array<{ url: string; alt: string }>
  pricePiastres: number
  compareAtPiastres: number | null
  discountPercent: number | null
  description: string
  points: string[]
}

export function quickViewOf(product: StoreProduct): QuickView {
  const discount = discountInfo(product)
  return {
    name: product.name_ar,
    nameEn: (product.name_en ?? '').trim(),
    images: galleryImages(product).map((image) => ({ url: image.url, alt: image.alt || product.name_ar })),
    pricePiastres: product.price_per_meter_piastres,
    compareAtPiastres: discount ? discount.compareAtPiastres : null,
    discountPercent: discount ? discount.percent : null,
    description: (product.description_ar ?? '').trim(),
    points: keyPoints(product),
  }
}
