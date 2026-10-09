import 'server-only'

import { parseEvents, parseGateState, parsePeriods, type GateState, type OrderEvent, type PeriodsView } from '../orders/cycle'
import { callOrderRpc, type OrderRpcResponse } from '../orders/rpc'

/**
 * 0021-A A2 — قراءات دورة الطلب لصفحة الطلب، بجلسة المستخدم (zell_order_events · zell_order_gate_state ·
 * zell_order_delivery_periods). أي فشل = null، والصفحة بتعرض «مش متاح دلوقتي» من غير ما تقع.
 * البوابة لو مش معروفة بتتعامل كإنها مقفولة.
 */
export type OrderCycleView = {
  events: OrderEvent[] | null
  gate: GateState | null
  periods: PeriodsView | null
}

function dataOf(response: OrderRpcResponse | null): unknown {
  if (response === null || (response.error !== null && response.error !== undefined)) return null
  return response.data
}

export async function getOrderCycleView(orderId: number): Promise<OrderCycleView> {
  const [events, gate, periods] = await Promise.all([
    callOrderRpc('events', { p_order_id: orderId }),
    callOrderRpc('gateState', {}),
    callOrderRpc('deliveryPeriods', {}),
  ])
  return {
    events: parseEvents(dataOf(events)),
    gate: parseGateState(dataOf(gate)),
    periods: parsePeriods(dataOf(periods)),
  }
}
