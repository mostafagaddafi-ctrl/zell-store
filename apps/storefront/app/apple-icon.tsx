import { ImageResponse } from 'next/og'
import { LOGO_LETTER } from '../lib/brand/logo'
import { MarkImage, loadLogoFont } from '../lib/brand/logoImage'

/**
 * أيقونة iOS (180×180): مربع كامل من غير حواف دايرية ومن غير الإطار — iOS بيعمل الحواف لوحده.
 */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default async function AppleIcon() {
  return new ImageResponse(<MarkImage size={180} letter={LOGO_LETTER} frame={false} rounded={false} />, {
    ...size,
    fonts: await loadLogoFont(LOGO_LETTER),
  })
}
