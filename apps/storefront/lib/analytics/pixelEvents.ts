/**
 * META-PIXEL §٢-٤ — بيانات الأحداث بالمفاتيح المسموحة بس. منطق خالص.
 *
 * 🔒 مفيش رقم طلب ولا event_id ولا أي بيانات عميل. Purchase من رد السيرفر (لقطة الداتابيز) وبس لو replayed = false.
 */
export type PixelEvent = 'PageView' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase'

export type PixelParams = Record<string, string | number | string[]>

function contentIds(productIds: readonly number[]): string[] {
  return Array.from(new Set(productIds.map((id) => String(id))))
}

export function viewContentParams(productId: number, name: string): PixelParams {
  return { content_ids: [String(productId)], content_type: 'product', content_name: name }
}

export function addToCartParams(productId: number): PixelParams {
  return { content_ids: [String(productId)], content_type: 'product' }
}

export function initiateCheckoutParams(productIds: readonly number[]): PixelParams {
  return { content_ids: contentIds(productIds), content_type: 'product', num_items: productIds.length }
}

/** رد نجاح الطلب ⇐ Purchase، أو null لو replayed مش false بالظبط أو الإجمالي مش رقم صحيح سليم. */
export function purchaseParams(result: unknown, productIds: readonly number[]): PixelParams | null {
  if (typeof result !== 'object' || result === null) return null
  const order = (result as { order?: unknown }).order
  if (typeof order !== 'object' || order === null) return null
  const fields = order as Record<string, unknown>
  if (fields['replayed'] !== false) return null
  const total = fields['totalPiastres']
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return null
  return {
    value: total / 100,
    currency: 'EGP',
    content_ids: contentIds(productIds),
    content_type: 'product',
    num_items: productIds.length,
  }
}
