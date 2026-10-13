import type { MetadataRoute } from 'next'
import { SITE_URL } from '../lib/site'

/** كل المتجر مسموح، ما عدا السلة والدفع والإيصال والـ API. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/cart', '/checkout', '/order', '/api'] }],
    sitemap: SITE_URL + '/sitemap.xml',
  }
}
