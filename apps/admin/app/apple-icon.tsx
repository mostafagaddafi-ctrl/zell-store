import { ImageResponse } from 'next/og'
import { LOGO_LETTER } from '../lib/brand/logo'
import { MarkImage, loadLogoFont } from '../lib/brand/logoImage'

/**
 * أيقونة iOS (180×180): مربع كامل من غير حواف دايرية ومن غير الإطار — iOS بيعمل الحواف لوحده.
 * ⚠️ الـ id بامتداد .png (‎/apple-icon/180.png‎) علشان middleware اللوحة بيستثني مسارات الصور.
 */
export function generateImageMetadata() {
  return [{ id: '180.png', size: { width: 180, height: 180 }, contentType: 'image/png' }]
}

export default async function AppleIcon() {
  return new ImageResponse(<MarkImage size={180} letter={LOGO_LETTER} frame={false} rounded={false} />, {
    width: 180,
    height: 180,
    fonts: await loadLogoFont(LOGO_LETTER),
  })
}
