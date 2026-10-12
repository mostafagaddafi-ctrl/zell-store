import 'server-only'

import { parseCheckoutDeliverySettings, type CheckoutDeliverySettings } from '../orders/deliverySettings'
import { restRpc } from './rpc'

/**
 * 0021-D2 — قراية إعداد موعد التسليم (zell_checkout_delivery_settings، service_role، من غير كاش).
 * أي فشل (شبكة · صلاحية · الدالة مش موجودة · شكل غلط · متغيرات ناقصة) = null، والقرار في ../orders/deliverySettings.
 */
export async function readCheckoutDeliverySettings(): Promise<CheckoutDeliverySettings | null> {
  try {
    const result = await restRpc<unknown>('zell_checkout_delivery_settings', {})
    return result.ok ? parseCheckoutDeliverySettings(result.data) : null
  } catch {
    return null
  }
}
