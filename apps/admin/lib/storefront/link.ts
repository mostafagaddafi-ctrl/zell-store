/**
 * رابط المتجر في اللوحة: «معاينة المتجر» (القايمة الجانبية) و«شوف المتجر» (صفحة المحتوى). منطق خالص.
 *
 * المصدر STOREFRONT_URL من إعداد Vercel للوحة (كل نسخة بتضبطه)، بنفس فحص revalidateStorefront بالحرف:
 * https بس · من غير بيانات دخول ولا استعلام ولا # ولا مسار · والمضيف = STOREFRONT_HOST حرفيًا.
 * أي متغير غايب أو قيمة مش آمنة أو مضيف مش متطابق = STOREFRONT_LINK_FALLBACK (الرابط اللي كان مكتوب
 * في الكود قبل كده)، فاللينك عمره ما يبقى فاضي أو يروح لرابط مااتحققش منه.
 */
export const STOREFRONT_LINK_FALLBACK = 'https://zell-store-nine.vercel.app'

export type StorefrontLink = { href: string; source: 'env' | 'fallback' }

export function resolveStorefrontLink(rawUrl: string | undefined, rawHost: string | undefined): StorefrontLink {
  const fallback: StorefrontLink = { href: STOREFRONT_LINK_FALLBACK, source: 'fallback' }
  const raw = (rawUrl ?? '').trim()
  const allowedHost = (rawHost ?? '').trim().toLowerCase()
  if (raw === '' || allowedHost === '') return fallback

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fallback
  }

  if (url.protocol !== 'https:') return fallback
  if (url.username !== '' || url.password !== '') return fallback
  if (url.search !== '' || url.hash !== '') return fallback
  if (url.pathname !== '' && url.pathname !== '/') return fallback
  if (url.host.toLowerCase() !== allowedHost) return fallback

  return { href: url.origin, source: 'env' }
}
