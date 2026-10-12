import type { RpcResult } from '../data/rpc'
import type { NormalizedOrder } from './canonical'
import type { OrderErrorCode, OrderRequest } from './contracts'
import { decideDelivery, type CheckoutDeliverySettings } from './deliverySettings'
import { normalizeOrder, requestHash } from './requestHash'

/**
 * إنشاء الطلب من الراوت — الترتيب الملزم في 0021-D2 §٢-٣ (منطق خالص، والـ I/O بييجي من deps):
 *
 *   ١) التطبيع، و**الهاش من الصيغة القانونية لطلب العميل زي ما وصل** (ومعاه الموعد لو مبعوت)، قبل أي إعداد.
 *      requestHash بيحوّل الطلب المطبّع لنص ثابت (canonicalOrderJson) أول ما يتنادى، فالهاش مستقل عن أي نسخة
 *      بتتبعت للداتابيز بعدين (ر٦).
 *   ٢) لو فيه موعد بس: قراية الإعداد ← القرار (decideDelivery). القراية فشلت = DELIVERY_SETTINGS_UNAVAILABLE
 *      من غير أي نداء لـ zell_create_order (ر٣).
 *   ٣) النداء بنسخة جديدة من الطلب المطبّع (الموعد = القرار)، وبنفس المفتاح والهاش من (١).
 *
 * النتيجة: نفس المفتاح ونفس الطلب = إعادة الرد الأصلي دايمًا مهما الإعداد اتغيّر بين المحاولتين، وطلب مختلف بنفس
 * المفتاح = 45003 زي النهارده. ومن غير موعد = نفس الهاش ونفس النداء بالحرف بتوع النهارده.
 */

export type PlaceOrderIds = {
  idempotencyKey: string
  sessionHashHex: string
  receiptHashHex: string
}

export type PlaceOrderDeps = {
  /** null = القراية فشلت. بتتنادي بس لو الطلب فيه موعد. */
  readDeliverySettings: () => Promise<CheckoutDeliverySettings | null>
  createOrder: (args: Record<string, unknown>) => Promise<RpcResult<unknown>>
}

export type PlaceOrderOutcome =
  | { kind: 'failure'; code: OrderErrorCode; reason: 'hash' | 'delivery_settings' | 'rpc_threw' }
  | { kind: 'called'; result: RpcResult<unknown>; requestHash: string; preferredSent: boolean; preferredDropped: boolean }

/** معاملات zell_create_order — نفس النداء القديم بالحرف، والاختياري بيتبعت بس لو موجود. */
export function createOrderArgs(order: NormalizedOrder, ids: PlaceOrderIds, requestHashHex: string): Record<string, unknown> {
  return {
    p_items: order.items.map((item) =>
      item.quantity !== undefined
        ? { productId: item.productId, quantity: item.quantity }
        : item.widthCm === undefined
          ? { productId: item.productId, lengthCm: item.lengthCm }
          : { productId: item.productId, lengthCm: item.lengthCm, widthCm: item.widthCm },
    ),
    p_customer_name: order.customerName,
    p_customer_phone: order.customerPhone,
    p_governorate: order.governorate,
    p_address: order.address,
    p_notes: order.notes,
    p_idempotency_key: ids.idempotencyKey,
    p_request_hash: requestHashHex,
    p_checkout_session_hash: ids.sessionHashHex,
    p_receipt_token_hash: ids.receiptHashHex,
    // 0018 — بيتبعتوا بس لما يكونوا موجودين، فالطلب العادي نفس النداء القديم بالحرف
    ...(order.area !== null ? { p_area: order.area } : {}),
    ...(order.installation ? { p_installation: true } : {}),
    // 0019 — الكود المطبّع بس ولو موجود بس
    ...(order.couponCode !== null ? { p_coupon_code: order.couponCode } : {}),
    // 0021-D — الموعد بس ولو موجود بس (0021-D2: بعد قرار الإعداد)
    ...(order.preferredDelivery !== null ? { p_preferred_delivery: order.preferredDelivery } : {}),
  }
}

export async function placeOrder(request: OrderRequest, ids: PlaceOrderIds, deps: PlaceOrderDeps): Promise<PlaceOrderOutcome> {
  const normalized = normalizeOrder(request)

  // (١) الهاش من طلب العميل زي ما وصل — قبل قراية الإعداد وقبل أي تعديل على الموعد.
  let requestHashHex: string
  try {
    requestHashHex = await requestHash(normalized)
  } catch {
    return { kind: 'failure', code: 'INTERNAL', reason: 'hash' }
  }

  // (٢) الإعداد بس لو فيه موعد.
  const settings = normalized.preferredDelivery !== null ? await deps.readDeliverySettings() : null
  const decision = decideDelivery(normalized.preferredDelivery, settings)
  if (decision.kind === 'unavailable') {
    return { kind: 'failure', code: 'DELIVERY_SETTINGS_UNAVAILABLE', reason: 'delivery_settings' }
  }

  // (٣) نسخة جديدة للداتابيز — normalized نفسه مابيتغيّرش.
  const forDb: NormalizedOrder = { ...normalized, preferredDelivery: decision.preferredDelivery }
  let result: RpcResult<unknown>
  try {
    result = await deps.createOrder(createOrderArgs(forDb, ids, requestHashHex))
  } catch {
    return { kind: 'failure', code: 'INTERNAL', reason: 'rpc_threw' }
  }
  return {
    kind: 'called',
    result,
    requestHash: requestHashHex,
    preferredSent: decision.preferredDelivery !== null,
    preferredDropped: decision.dropped,
  }
}
