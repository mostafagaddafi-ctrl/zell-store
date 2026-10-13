/**
 * رابط المتجر في اللوحة: «معاينة المتجر» (القايمة الجانبية) و«شوف المتجر» (صفحة المحتوى). منطق خالص.
 *
 * المصدر STOREFRONT_URL وSTOREFRONT_HOST من إعداد Vercel للوحة (كل نسخة بتضبطهم)، بنفس فحص
 * revalidateStorefront بالحرف: https بس · من غير بيانات دخول ولا استعلام ولا # ولا مسار · والمضيف =
 * STOREFRONT_HOST حرفيًا.
 *
 * ⚠️ **مفيش رابط احتياطي:** لو الإعداد ناقص أو مش صالح أو مش متطابق، النتيجة ok = false، واللوحة
 * بتخبّي اللينكين وبتعرض STOREFRONT_LINK_NOT_SET بدلهم — عمرها ما تفتح متجر مااتحققش منه.
 */

export type StorefrontLinkProblem = 'missing' | 'invalid' | 'mismatch'

export type StorefrontLink = { ok: true; href: string } | { ok: false; reason: StorefrontLinkProblem }

/** التنبيه اللي بيظهر مكان اللينكين (نص رسمي — قرار لغة اللوحة). */
export const STOREFRONT_LINK_NOT_SET =
  'رابط المتجر غير مضبوط: يلزم ضبط STOREFRONT_URL وSTOREFRONT_HOST في إعدادات Vercel للوحة بقيمتين صحيحتين ومتطابقتين، ثم إعادة النشر (Redeploy).'

export function resolveStorefrontLink(rawUrl: string | undefined, rawHost: string | undefined): StorefrontLink {
  const raw = (rawUrl ?? '').trim()
  const allowedHost = (rawHost ?? '').trim().toLowerCase()
  if (raw === '' || allowedHost === '') return { ok: false, reason: 'missing' }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'invalid' }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'invalid' }
  if (url.search !== '' || url.hash !== '') return { ok: false, reason: 'invalid' }
  if (url.pathname !== '' && url.pathname !== '/') return { ok: false, reason: 'invalid' }
  if (url.host.toLowerCase() !== allowedHost) return { ok: false, reason: 'mismatch' }

  return { ok: true, href: url.origin }
}
