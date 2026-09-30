import 'server-only'

import { imageSize } from 'image-size'

/**
 * قراءة أبعاد الصورة من **الهيدر بس**.
 *
 * ⚠️ ممنوع أي فك ضغط للبكسلات. فك الضغط هو اللي بيفتح باب
 * decompression bomb — صورة ٢ كيلوبايت تتحول جيجابايتات في الرام —
 * وإحنا مش محتاجين البكسلات أصلاً، محتاجين رقمين.
 *
 * image-size بتقرا الهيدر بس، وpure JS من غير أي binary.
 *
 * الفشل هنا **مابيرفضش** الصورة: العمودين width_px و height_px
 * nullable، والأبعاد بيانات وصفية مش شرط قبول. صورة سليمة بهيدر
 * غريب لازم تترفع عادي.
 */

export type ImageDimensions = { width: number | null; height: number | null }

const UNKNOWN: ImageDimensions = { width: null, height: null }

/** القيد في الداتابيز: لو مش null لازم تكون أكبر من صفر. */
function usable(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isInteger(value) || value <= 0) return null
  return value
}

export function readImageDimensions(bytes: Uint8Array): ImageDimensions {
  try {
    const size = imageSize(bytes)
    return { width: usable(size.width), height: usable(size.height) }
  } catch {
    return UNKNOWN
  }
}
