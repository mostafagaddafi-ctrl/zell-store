import { ImageResponse } from 'next/og'
import { LOGO_LETTER } from '../lib/brand/logo'
import { MarkImage, loadLogoFont } from '../lib/brand/logoImage'

/**
 * أيقونة الموقع (التاب وشاشة الموبايل): العلامة بالإطار والحواف، بتتولّد بالكود (من غير ملف صورة).
 * المسارات: ‎/icon/32‎ · ‎/icon/192‎ · ‎/icon/512‎ (والـ manifest بيشاور على 192 و512).
 */
const SIZES = [32, 192, 512]

export function generateImageMetadata() {
  return SIZES.map((size) => ({ id: String(size), size: { width: size, height: size }, contentType: 'image/png' }))
}

export default async function Icon({ id }: { id: string }) {
  const size = SIZES.find((value) => String(value) === id) ?? 32
  return new ImageResponse(<MarkImage size={size} letter={LOGO_LETTER} frame rounded />, {
    width: size,
    height: size,
    fonts: await loadLogoFont(LOGO_LETTER),
  })
}
