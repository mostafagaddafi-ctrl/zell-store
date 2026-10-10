import 'server-only'

import { createAuthClient } from '../auth/supabaseServer'

/**
 * 0021-A A2 — نداء دوال دورة الطلب zell_order_* — سيرفر بس، بجلسة المستخدم (createAuthClient: anon key + كوكيز الجلسة)،
 * زي المخزون في 0020-S. الدوال دي EXECUTE لـ authenticated بس، والممثل = sub من JWT الجلسة جوه الداتابيز
 * (ومعاه صف شغّال في admin_users). مفيش أي معامل ممثل من الكود ولا من الفورم، ومفيش service_role.
 * أسماء الدوال ثابتة هنا؛ مفيش اسم بييجي من أي مدخلات.
 */
export const ORDER_FUNCTIONS = {
  transition: 'zell_order_transition',
  recordCall: 'zell_order_record_call',
  setFollowUp: 'zell_order_set_follow_up',
  setConfirmedDelivery: 'zell_order_set_confirmed_delivery',
  editDetails: 'zell_order_edit_details',
  setInternalNote: 'zell_order_set_internal_note',
  events: 'zell_order_events',
  deliveryPeriods: 'zell_order_delivery_periods',
  gateState: 'zell_order_gate_state',
  // 0021-A P2 — الدفعات ورسوم التأكيد (zell_payment_*، P1): نفس النداء بجلسة المستخدم.
  paymentSummary: 'zell_payment_order_summary',
  recordPayment: 'zell_payment_record',
  refundPayment: 'zell_payment_refund',
  deliverOrder: 'zell_payment_deliver_order',
  paymentMethods: 'zell_payment_list_methods',
  addPaymentMethod: 'zell_payment_add_method',
  updatePaymentMethod: 'zell_payment_update_method',
  deletePaymentMethod: 'zell_payment_delete_method',
  paymentSettings: 'zell_payment_get_settings',
  savePaymentSettings: 'zell_payment_save_settings',
} as const

export type OrderFunction = keyof typeof ORDER_FUNCTIONS

/** الأجزاء الوحيدة اللي بنبصّ فيها من رد supabase-js. null = النداء نفسه فشل (شبكة أو مهلة). */
export type OrderRpcResponse = { data: unknown; error: unknown; status: number }

const TIMEOUT_MS = 10000

export async function callOrderRpc(fn: OrderFunction, args: Record<string, unknown>): Promise<OrderRpcResponse | null> {
  try {
    const supabase = await createAuthClient()
    const result = await supabase.rpc(ORDER_FUNCTIONS[fn], args).abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    return { data: result.data as unknown, error: result.error, status: result.status }
  } catch {
    return null
  }
}
