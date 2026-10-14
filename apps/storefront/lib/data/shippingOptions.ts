import 'server-only'

import { parseShippingOptions, type ShippingOptions } from '@zell/core'
import { restRpc } from './rpc'

/**
 * EXPRESS-SHIPPING W2 — قراية إعداد الشحن السريع ومدة الشحن (zell_shipping_options_checkout، service_role، من غير كاش).
 * أي فشل (شبكة · صلاحية · الدالة مش موجودة · شكل غلط · متغيرات ناقصة) = null: اختيار الطريقة مايظهرش والطلب عادي.
 * /api/orders مابيقراش الإعداد خالص — الداتابيز هي الحكم (45431 لو السريع اتقفل).
 */
export async function readCheckoutShippingOptions(): Promise<ShippingOptions | null> {
  try {
    const result = await restRpc<unknown>('zell_shipping_options_checkout', {})
    return result.ok ? parseShippingOptions(result.data) : null
  } catch {
    return null
  }
}
