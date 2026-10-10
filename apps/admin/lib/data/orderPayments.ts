import 'server-only'

import { parseMethods, parsePaymentSummary, parseSettings, type PaymentMethod, type PaymentSettings, type PaymentSummary } from '../orders/payments'
import { callOrderRpc, type OrderRpcResponse } from '../orders/rpc'

/**
 * 0021-A P2 — قراءات الدفع بجلسة المستخدم (zell_payment_order_summary · zell_payment_list_methods · zell_payment_get_settings).
 * أي فشل = null، والصفحة بتعرض «مش متاح دلوقتي» من غير ما تقع (ومنها لو P1 لسه مش متطبّق).
 */
export type OrderPaymentsView = {
  summary: PaymentSummary | null
  methods: PaymentMethod[] | null
  settings: PaymentSettings | null
}

function dataOf(response: OrderRpcResponse | null): unknown {
  if (response === null || (response.error !== null && response.error !== undefined)) return null
  return response.data
}

export async function getOrderPaymentsView(orderId: number): Promise<OrderPaymentsView> {
  const [summary, methods, settings] = await Promise.all([
    callOrderRpc('paymentSummary', { p_order_id: orderId }),
    callOrderRpc('paymentMethods', {}),
    callOrderRpc('paymentSettings', {}),
  ])
  return {
    summary: parsePaymentSummary(dataOf(summary)),
    methods: parseMethods(dataOf(methods)),
    settings: parseSettings(dataOf(settings)),
  }
}

export async function getPaymentAdminView(): Promise<{ methods: PaymentMethod[] | null; settings: PaymentSettings | null }> {
  const [methods, settings] = await Promise.all([callOrderRpc('paymentMethods', {}), callOrderRpc('paymentSettings', {})])
  return { methods: parseMethods(dataOf(methods)), settings: parseSettings(dataOf(settings)) }
}
