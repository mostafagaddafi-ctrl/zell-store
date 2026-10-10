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
