import 'server-only'

import { parseDeliverySettings, type DeliverySettings } from '../orders/deliverySettings'
import { callOrderRpc } from '../orders/rpc'

/**
 * 0021-D2 — قراية إعداد موعد التسليم بجلسة المستخدم (zell_delivery_settings_get — أي أدمن شغّال).
 * أي فشل = null، والكارت بيعرض «مش متاح دلوقتي» من غير ما الصفحة تقع.
 */
export async function getDeliverySettings(): Promise<DeliverySettings | null> {
  const response = await callOrderRpc('deliverySettings', {})
  if (response === null || (response.error !== null && response.error !== undefined)) return null
  return parseDeliverySettings(response.data)
}
