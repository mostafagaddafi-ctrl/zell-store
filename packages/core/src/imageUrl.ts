/**
 * نقطة واحدة لتركيب روابط الصور.
 * الداتابيز بتخزّن object_path بس — تغيير المشروع أو إضافة CDN = تعديل هنا فقط.
 *
 * ملاحظة مرحلة ١: جداول الصور موجودة في Production لكن لسه مفيش ملفات مرفوعة،
 * فالمتجر بيستخدم الرسمة الاحتياطية. الدوال دي جاهزة لمرحلة ربط Storage.
 */

export type StoredImage = {
  bucket: string
  object_path: string
}

function encodeObjectPath(objectPath: string): string {
  return objectPath
    .split('/')
    .filter((part) => part !== '')
    .map(encodeURIComponent)
    .join('/')
}

export function publicImageUrl(supabaseUrl: string, image: StoredImage): string {
  const base = supabaseUrl.replace(/\/+$/, '')
  return base + '/storage/v1/object/public/' + image.bucket + '/' + encodeObjectPath(image.object_path)
}

/** الأعمدة القديمة لسه موجودة — قراءة مزدوجة لحد ما الترحيل يكتمل. */
export function legacyImages(product: { image_url: string | null; images: string[] }): string[] {
  const all = [product.image_url, ...(product.images ?? [])]
  return all.filter((url): url is string => typeof url === 'string' && url.trim() !== '')
}
