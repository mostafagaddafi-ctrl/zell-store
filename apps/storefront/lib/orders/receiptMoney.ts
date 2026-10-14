import { parseShippingSnapshot, type ShippingDays, type ShippingMethod } from '@zell/core'
import { restSelect } from '../data/rpc'
import { parseOrderMoney, type OrderMoney } from './confirmationFee'

/**
 * 0021-A P2 — مبالغ الدفع للطلب (الإجمالي · المدفوع · رسوم التأكيد) من الطلب نفسه بمفتاح الخدمة — سيرفر بس.
 * بتتنادى من الإيصال (بعد ما zell_get_order_receipt اتحققت من التوكن) ومن إشعار الطلب الجديد. أي فشل = null.
 */
export async function fetchOrderMoney(orderNumber: string): Promise<OrderMoney | null> {
  try {
    const result = await restSelect<unknown>(
      'orders',
      'order_number=eq.' + encodeURIComponent(orderNumber) + '&select=total_piastres,paid_piastres,confirmation_fee_piastres',
    )
    return result.ok && result.data.length === 1 ? parseOrderMoney(result.data[0]) : null
  } catch {
    return null
  }
}

/**
 * EXPRESS-SHIPPING W2 — نوع الشحن ومدته من لقطة الطلب بمفتاح الخدمة — سيرفر بس، ومن الإيصال **بعد** ما zell_get_order_receipt
 * اتحققت من التوكن (زي fetchOrderMoney). الطلب القديم (shipping_method = NULL) أو أي فشل = null (من غير سطر نوع).
 */
export async function fetchOrderShipping(orderNumber: string): Promise<{ method: ShippingMethod; days: ShippingDays | null } | null> {
  try {
    const result = await restSelect<unknown>(
      'orders',
      'order_number=eq.' + encodeURIComponent(orderNumber) + '&select=shipping_method,shipping_days_min,shipping_days_max',
    )
    if (!result.ok || result.data.length !== 1) return null
    const row = result.data[0]
    if (typeof row !== 'object' || row === null) return null
    const record = row as Record<string, unknown>
    return parseShippingSnapshot(record['shipping_method'], record['shipping_days_min'], record['shipping_days_max'])
  } catch {
    return null
  }
}
