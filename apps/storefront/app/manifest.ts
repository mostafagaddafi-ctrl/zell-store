import type { MetadataRoute } from 'next'
import { getStorefrontSettings } from '../lib/data/source'
import { SITE_NAME_FALLBACK } from '../lib/site'
import { MANIFEST_ICONS } from '../lib/seo/icons'

/** manifest بسيط: الاسم + الأيقونات (ملفات ثابتة في public/، Z-ICON — lib/seo/icons.ts) + themeColor. وقت الطلب، مش وقت البناء. */
export const dynamic = 'force-dynamic'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let name = SITE_NAME_FALLBACK
  try {
    name = (await getStorefrontSettings()).storeName.trim() || SITE_NAME_FALLBACK
  } catch {
    name = SITE_NAME_FALLBACK
  }
  return {
    name,
    short_name: name,
    start_url: '/',
    display: 'standalone',
    background_color: '#FAF7F2',
    theme_color: '#FAF7F2',
    icons: MANIFEST_ICONS,
  }
}
