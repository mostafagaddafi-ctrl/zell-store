import { ImageResponse } from 'next/og'
import { LOGO_LETTER } from '../lib/brand/logo'
import { MarkImage, loadLogoFont } from '../lib/brand/logoImage'

/**
 * أيقونة الموقع (التاب وشاشة الموبايل): العلامة بالإطار والحواف، بتتولّد بالكود (من غير ملف صورة).
 * المسارات: ‎/icon/48‎ · ‎/icon/96‎ · ‎/icon/192‎ · ‎/icon/512‎ (والـ manifest بيشاور على 192 و512).
 */
// SEO-BASICS: 48 و96 علشان جوجل بيفضّل مضاعفات 48، و/favicon.ico بيتحوّل لـ /icon/48 (next.config.mjs).
// FAVICON-ORDER (2026-11-09): الـ 32 اتشالت، فأول أيقونة معلنة في الصفحة = 48 ثم 96. تجربة على افتراض إن جوجل بيفضّل
// مضاعفات 48 (مش سبب مثبت — docs/contracts/FAVICON-ORDER.md §٢).
// 192 و512 فاضلين علشان الـ manifest (الـ 512 مش مضاعف 48، بس هي الأخيرة).
const SIZES = [48, 96, 192, 512]

export function generateImageMetadata() {
  return SIZES.map((size) => ({ id: String(size), size: { width: size, height: size }, contentType: 'image/png' }))
}

export default async function Icon({ id }: { id: string }) {
  const size = SIZES.find((value) => String(value) === id) ?? 48
  return new ImageResponse(<MarkImage size={size} letter={LOGO_LETTER} frame rounded />, {
    width: size,
    height: size,
    fonts: await loadLogoFont(LOGO_LETTER),
  })
}
