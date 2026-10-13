import { ImageResponse } from 'next/og'
import { LOGO_LETTER } from '../lib/brand/logo'
import { MarkImage, loadLogoFont } from '../lib/brand/logoImage'

/**
 * أيقونة الموقع (التاب وشاشة الموبايل): العلامة بالإطار والحواف، بتتولّد بالكود (من غير ملف صورة).
 * ⚠️ الـ id بامتداد .png (‎/icon/32.png‎) علشان middleware اللوحة بيستثني مسارات الصور — من غيره الأيقونة بتتحوّل
 *    لصفحة الدخول لأي حد مش داخل. مفيش أي تعديل في الـ middleware.
 */
const SIZES = [32, 192, 512]

export function generateImageMetadata() {
  return SIZES.map((size) => ({ id: String(size) + '.png', size: { width: size, height: size }, contentType: 'image/png' }))
}

export default async function Icon({ id }: { id: string }) {
  const size = SIZES.find((value) => String(value) + '.png' === id) ?? 32
  return new ImageResponse(<MarkImage size={size} letter={LOGO_LETTER} frame rounded />, {
    width: size,
    height: size,
    fonts: await loadLogoFont(LOGO_LETTER),
  })
}
