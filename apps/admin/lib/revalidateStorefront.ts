import 'server-only'

export const REVALIDATION_WARNING = 'تم الحفظ، لكن تحديث المتجر الفوري فشل وقد يتأخر الظهور حتى 5 دقائق'

export async function revalidateStorefront(): Promise<boolean> {
  const baseUrl = (process.env['STOREFRONT_URL'] ?? '').trim().replace(/\/+$/, '')
  const secret = (process.env['REVALIDATE_SECRET'] ?? '').trim()
  if (baseUrl === '' || secret === '') return false

  try {
    const response = await fetch(baseUrl + '/api/revalidate', {
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
