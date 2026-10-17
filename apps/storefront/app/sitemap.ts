import type { MetadataRoute } from 'next'
import { isListed, policyPath, publishedPolicyKeys } from '@zell/core'
import { getStorefrontData } from '../lib/data/source'
import { SITE_URL } from '../lib/site'

/**
 * الرئيسية + الأقسام اللي ليها صفحة (showInNav) + المنتجات الظاهرة (isListed) + صفحات السياسات المنشورة بس (POLICY-PAGES) — من getStorefrontData المكاشة.
 * وقت الطلب، مش وقت البناء؛ ولو القراية فشلت بيرجّع الرئيسية بس.
 */
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const home = { url: SITE_URL + '/' }
  try {
    const { collections, products, settings } = await getStorefrontData()
    return [
      home,
      ...collections.filter((collection) => collection.showInNav).map((collection) => ({ url: SITE_URL + '/collection/' + collection.slug })),
      ...products.filter((product) => isListed(product)).map((product) => ({ url: SITE_URL + '/product/' + String(product.id) })),
      ...publishedPolicyKeys(settings.policies).map((key) => ({ url: SITE_URL + policyPath(key) })),
    ]
  } catch {
    return [home]
  }
}
