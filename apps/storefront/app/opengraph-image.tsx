import { ImageResponse } from 'next/og'
import { LOGO_LETTER, logoHex, logoLetter } from '../lib/brand/logo'
import { MarkImage, WordmarkImage, loadLogoFont } from '../lib/brand/logoImage'
import { getStorefrontSettings } from '../lib/data/source'
import { SITE_NAME_FALLBACK } from '../lib/site'

/**
 * معاينة المشاركة الافتراضية (1200×630): خلفية bg، والاسم الكامل في النص، وشريط gold تحت.
 * من غير أي نص عربي جوه الصورة: لو اسم المتجر عربي بتظهر العلامة بس. وقت الطلب، مش وقت البناء.
 */
export const alt = 'شعار المتجر'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

const ARABIC = /[\u0600-\u06FF]/

export default async function OpengraphImage() {
  let name = SITE_NAME_FALLBACK
  try {
    name = (await getStorefrontSettings()).storeName.trim() || SITE_NAME_FALLBACK
  } catch {
    name = SITE_NAME_FALLBACK
  }
  const latin = !ARABIC.test(name)
  const letter = latin ? logoLetter(name) : LOGO_LETTER
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: logoHex('page') }}>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {latin ? <WordmarkImage name={name} size={120} letter={letter} /> : <MarkImage size={240} letter={letter} frame rounded />}
        </div>
        <div style={{ display: 'flex', height: 18, background: logoHex('accent') }} />
      </div>
    ),
    { ...size, fonts: await loadLogoFont(latin ? letter + name : letter) },
  )
}
