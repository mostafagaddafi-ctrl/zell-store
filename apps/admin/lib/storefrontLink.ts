import 'server-only'
import { resolveStorefrontLink } from './storefront/link'

/**
 * رابط المتجر للّينكين في اللوحة («معاينة المتجر» · «شوف المتجر»)، من STOREFRONT_URL وSTOREFRONT_HOST
 * في إعداد Vercel للوحة. سيرفر بس (المتغيرات مش NEXT_PUBLIC_)، والقيمة بتتبعت للمكوّن كـ prop.
 * الفحص والرابط الاحتياطي في lib/storefront/link.ts.
 */
export function storefrontLinkHref(): string {
  return resolveStorefrontLink(process.env['STOREFRONT_URL'], process.env['STOREFRONT_HOST']).href
}
