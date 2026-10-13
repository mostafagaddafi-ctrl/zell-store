import 'server-only'
import { resolveStorefrontLink } from './storefront/link'

/**
 * رابط المتجر للّينكين في اللوحة («معاينة المتجر» · «شوف المتجر»)، من STOREFRONT_URL وSTOREFRONT_HOST
 * في إعداد Vercel للوحة. سيرفر بس (المتغيرات مش NEXT_PUBLIC_)، والقيمة بتتبعت للمكوّن كـ prop.
 * null = الإعداد ناقص أو مش صالح أو مش متطابق: المكوّن بيخبّي اللينك وبيعرض STOREFRONT_LINK_NOT_SET.
 * مفيش رابط احتياطي. الفحص في lib/storefront/link.ts.
 */
export function storefrontLinkHref(): string | null {
  const link = resolveStorefrontLink(process.env['STOREFRONT_URL'], process.env['STOREFRONT_HOST'])
  return link.ok ? link.href : null
}
