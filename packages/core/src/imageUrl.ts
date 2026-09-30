/**
 * نقطة واحدة لتركيب روابط الصور.
 * الداتابيز بتخزّن object_path بس — تغيير المشروع أو إضافة CDN = تعديل هنا فقط.
 *
 * الصيغة العامة:
 *   {SUPABASE_URL}/storage/v1/object/public/{bucket}/{object_path}
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
