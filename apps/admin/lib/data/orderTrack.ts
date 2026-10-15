import 'server-only'

import { callOrderRpc, type OrderRpcResponse } from '../orders/rpc'
import {
  parseShipmentView,
  parseUpdatesView,
  shipmentBounds,
  type ShipmentBounds,
  type ShipmentView,
  type UpdatesView,
} from '../orders/trackUpdates'

/**
 * TRACK-ORDER v2 W2-B — قراية الشحنة ورسائل العميل لصفحة الطلب بجلسة المستخدم (zell_shipment_get و zell_customer_update_list —
 * أي أدمن شغّال أو المالك)، بالطلب برقمه. أي فشل أو رد لطلب تاني = null، والكارت بيعرض «غير متاح حاليًا» من غير ما الصفحة تقع.
 * حدود التواريخ (يوم الطلب والنهارده بتوقيت القاهرة) للتحقق المبدئي في الكارت بس؛ القرار في الداتابيز (45433).
 */
export type OrderTrackAdminView = {
  shipment: ShipmentView | null
  updates: UpdatesView | null
  bounds: ShipmentBounds | null
}

export async function getOrderTrackAdminView(orderNumber: string, orderCreatedAt: string): Promise<OrderTrackAdminView> {
  const [shipmentResponse, updatesResponse] = await Promise.all([
    callOrderRpc('shipment', { p_order_number: orderNumber }),
    callOrderRpc('customerUpdates', { p_order_number: orderNumber }),
  ])
  const ok = (response: OrderRpcResponse | null): response is OrderRpcResponse =>
    response !== null && (response.error === null || response.error === undefined)
  const shipment = ok(shipmentResponse) ? parseShipmentView(shipmentResponse.data) : null
  const updates = ok(updatesResponse) ? parseUpdatesView(updatesResponse.data) : null
  return {
    shipment: shipment !== null && shipment.orderNumber === orderNumber ? shipment : null,
    updates: updates !== null && updates.orderNumber === orderNumber ? updates : null,
    bounds: shipmentBounds(orderCreatedAt, Date.now()),
  }
}
