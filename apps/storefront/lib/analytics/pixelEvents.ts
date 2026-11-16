/**
 * META-PIXEL §٢-٤ — بيانات الأحداث بالمفاتيح المسموحة بس. منطق خالص.
 *
 * 🔒 مفيش رقم طلب ولا event_id ولا أي بيانات عميل. Purchase من رد السيرفر (لقطة الداتابيز) وبس لو replayed = false.
 */
export type PixelEvent = 'PageView' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase'

export type PixelParams = Record<string, string | number | string[]>

/** سطر سلة للأحداث: المنتج وكميته (سطر القطعة) — سطر المتر من غير كمية. */
export type PixelLine = { productId: number; quantity?: number | undefined }

function contentIds(lines: readonly PixelLine[]): string[] {
  return Array.from(new Set(lines.map((line) => String(line.productId))))
}

/** num_items = مجموع الكميات: سطر القطعة بكميته، وسطر المتر (أو كمية مش صحيحة موجبة) = 1. */
export function numItems(lines: readonly PixelLine[]): number {
  return lines.reduce(
    (sum, line) => sum + (typeof line.quantity === 'number' && Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1),
    0,
  )
}

export function viewContentParams(productId: number, name: string): PixelParams {
  return { content_ids: [String(productId)], content_type: 'product', content_name: name }
}

export function addToCartParams(productId: number): PixelParams {
  return { content_ids: [String(productId)], content_type: 'product' }
}

export function initiateCheckoutParams(lines: readonly PixelLine[]): PixelParams {
  return { content_ids: contentIds(lines), content_type: 'product', num_items: numItems(lines) }
}

/** رد نجاح الطلب ⇐ Purchase، أو null لو replayed مش false بالظبط أو الإجمالي مش رقم صحيح سليم. */
export function purchaseParams(result: unknown, lines: readonly PixelLine[]): PixelParams | null {
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
    content_ids: contentIds(lines),
    content_type: 'product',
    num_items: numItems(lines),
  }
}
