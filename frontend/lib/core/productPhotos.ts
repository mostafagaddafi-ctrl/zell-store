import type { StoreProduct } from './types'
import { localProductPhotos } from '../../assets/productPhotos'

/**
 * صور المنتج بالترتيب: صور الداتابيز أولاً، وإلا الصور المدمجة في التطبيق.
 * لو الاتنين فاضيين بترجع [] والواجهة بتعرض الرسمة التوضيحية.
 */
export function productPhotos(product: StoreProduct): string[] {
  const fromDb = [product.image_url, ...(product.images ?? [])].filter(
    (url): url is string => typeof url === 'string' && url.trim() !== '',
  )
  if (fromDb.length > 0) return fromDb
  return localProductPhotos(product.name_ar, product.name_en)
}
