import 'server-only'

import type { ImageFit } from '../enums'
import { invalid, wholeNumber, type ValidationFailure } from './shared'

/**
 * ⚠️ معرّف الصورة **نص** مش رقم.
 * العمود bigint، والقيم فوق 2^53 بتفقد دقتها لو دخلت Number.
 * عشان كده بيتفحص كنص أرقام وبيتبعت كنص لحد الداتابيز.
 */
const BIGINT_TEXT = /^[0-9]+$/

export function validateImageId(value: unknown): { ok: true; value: string } | ValidationFailure {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!BIGINT_TEXT.test(text)) return invalid('معرّف الصورة غير صالح')
  return { ok: true, value: text }
}

/** نفس قيد product_images_fit_check بالظبط. */
export function validateFit(value: unknown): { ok: true; value: ImageFit } | ValidationFailure {
  if (value !== 'cover' && value !== 'contain') return invalid('طريقة العرض لازم تكون cover أو contain')
  return { ok: true, value }
}

export function validateProductId(value: unknown): { ok: true; value: number } | ValidationFailure {
  const id = wholeNumber(value, 'معرّف المنتج')
  if (!id.ok) return id
  if (id.value <= 0) return invalid('معرّف المنتج غير صالح')
  return { ok: true, value: id.value }
}
