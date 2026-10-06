/**
 * نتيجة zell_create_order → رد الواجهة. منطق خالص اتنقل من راوت الطلب عشان يتختبر.
 *
 * 🔒 الرد = لقطة الداتابيز كما هي، للطلب الجديد وللـreplay. مفيش أي إعادة حساب هنا
 *    للخصم ولا للإجمالي ولا لأي رقم — الـreplay بيرجّع اللي اتسجّل وقت الإنشاء بالظبط.
 */

import type { CreateOrderResult, OrderSuccess } from './contracts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * حارس شكل النتيجة. 0019: discount_piastres و coupon_code لو موجودين لازم بشكلهم الصحيح
 * (رقم صحيح مش سالب · نص أو null). ناقصين = مفيش خصم.
 */
export function isCreateOrderResult(value: unknown): value is CreateOrderResult {
  if (!isPlainObject(value)) return false
  if (
    !(
      typeof value['order_number'] === 'string' &&
      typeof value['replayed'] === 'boolean' &&
      typeof value['subtotal_piastres'] === 'number' &&
      typeof value['shipping_piastres'] === 'number' &&
      typeof value['total_piastres'] === 'number' &&
      typeof value['receipt_expires_at'] === 'string'
    )
  ) {
    return false
  }

  const discount = value['discount_piastres']
  if (discount !== undefined && !(typeof discount === 'number' && Number.isSafeInteger(discount) && discount >= 0)) {
    return false
  }
  const couponCode = value['coupon_code']
  if (couponCode !== undefined && couponCode !== null && typeof couponCode !== 'string') return false
  return true
}

export function orderSuccessBody(order: CreateOrderResult): OrderSuccess {
  return {
    ok: true,
    order: {
      orderNumber: order.order_number,
      subtotalPiastres: order.subtotal_piastres,
      shippingPiastres: order.shipping_piastres,
      totalPiastres: order.total_piastres,
      installationPiastres: typeof order.installation_piastres === 'number' ? order.installation_piastres : 0,
      installationTravelPiastres:
        typeof order.installation_travel_piastres === 'number' ? order.installation_travel_piastres : 0,
      // 0019 — من اللقطة: null/0 لو مفيش كوبون
      couponCode: typeof order.coupon_code === 'string' ? order.coupon_code : null,
      discountPiastres: typeof order.discount_piastres === 'number' ? order.discount_piastres : 0,
      replayed: order.replayed,
    },
  }
}
