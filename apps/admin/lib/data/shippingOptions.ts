import 'server-only'

import { parseShippingOptionsSettings, type ShippingOptionsSettings } from '../orders/shippingOptions'
import { callOrderRpc } from '../orders/rpc'

/**
 * EXPRESS-SHIPPING W2 — قراية إعداد مدة الشحن والشحن السريع بجلسة المستخدم (zell_shipping_options_get — أي أدمن شغّال).
 * أي فشل = null، والكارت بيعرض «غير متاح حاليًا» من غير ما الصفحة تقع.
 */
export async function getShippingOptions(): Promise<ShippingOptionsSettings | null> {
  const response = await callOrderRpc('shippingOptions', {})
  if (response === null || (response.error !== null && response.error !== undefined)) return null
  return parseShippingOptionsSettings(response.data)
}
