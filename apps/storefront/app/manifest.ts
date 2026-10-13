import type { MetadataRoute } from 'next'
import { getStorefrontSettings } from '../lib/data/source'
import { SITE_NAME_FALLBACK } from '../lib/site'

/** manifest بسيط: الاسم + الأيقونات (app/icon.tsx · app/apple-icon.tsx) + themeColor. وقت الطلب، مش وقت البناء. */
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
    icons: [
      { src: '/icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
