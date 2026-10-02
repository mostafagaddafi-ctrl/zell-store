import 'server-only'

export const REVALIDATION_WARNING = 'تم الحفظ، لكن تحديث المتجر الفوري فشل وقد يتأخر الظهور حتى 5 دقائق'

/**
 * يبني رابط /api/revalidate بعد تحقق صارم من STOREFRONT_URL،
 * حتى لا يتسرب REVALIDATE_SECRET إلى مضيف غير موثوق لو اتغيّر المتغير خطأً.
 * يرجع null عند أي فشل تحقق — بدون إرسال أي طلب وبدون تسجيل السر أو الرابط.
 */
function buildRevalidateUrl(): string | null {
  const raw = (process.env['STOREFRONT_URL'] ?? '').trim()
  const allowedHost = (process.env['STOREFRONT_HOST'] ?? '').trim().toLowerCase()
  if (raw === '' || allowedHost === '') return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.search !== '' || url.hash !== '') return null
  if (url.pathname !== '' && url.pathname !== '/') return null
  if (url.host.toLowerCase() !== allowedHost) return null

  return url.origin + '/api/revalidate'
}

export async function revalidateStorefront(): Promise<boolean> {
  const endpoint = buildRevalidateUrl()
  const secret = (process.env['REVALIDATE_SECRET'] ?? '').trim()
  if (endpoint === null || secret === '') return false

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-revalidate-secret': secret },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    return response.ok
  } catch {
    return false
  }
}
