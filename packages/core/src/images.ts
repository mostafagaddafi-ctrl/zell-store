import type { StoreImage, StoreProduct } from './types'

/**
 * ترتيب معتمد — نفس ترتيب استعلام الداتابيز:
 *   order by is_primary desc, sort_order asc, id asc
 *
 * بنرتّب هنا كمان كخط دفاع تاني: لو أي مصدر رجّع صفوف غير مرتّبة،
 * المعرض يفضل صح. الرئيسية دايمًا الأولى.
 */
export function sortStoreImages(images: StoreImage[]): StoreImage[] {
  return [...images].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    return a.id - b.id
  })
}

/** الصور المعروضة في المعرض — النوع gallery فقط، مرتّبة. */
export function galleryImages(product: StoreProduct): StoreImage[] {
  const fromGallery = product.gallery.filter((image) => image.kind === 'gallery')
  if (fromGallery.length > 0) return sortStoreImages(fromGallery)
  return legacyImages(product)
}

/** الصورة الرئيسية — المستخدمة كـ preview في كارت الصفحة الرئيسية. */
export function primaryImage(product: StoreProduct): StoreImage | null {
  return galleryImages(product)[0] ?? null
}

/**
 * قراءة مزدوجة: الأعمدة القديمة بتتحوّل لنفس الشكل لو المعرض الجديد فاضي.
 * بتتشال لما الترحيل يكتمل.
 */
function legacyImages(product: StoreProduct): StoreImage[] {
  const urls = [product.image_url, ...(product.images ?? [])].filter(
    (url): url is string => typeof url === 'string' && url.trim() !== '',
  )
  return urls.map((url, index) => ({
    id: -(index + 1),
    url,
    alt: product.name_ar,
    width: null,
    height: null,
    kind: 'gallery' as const,
    isPrimary: index === 0,
  }))
}
