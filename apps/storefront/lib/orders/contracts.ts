/**
 * عقود مسار الطلب — ORDER-FLOW-PLAN.md §1.1 و§1.2.
 *
 * ⚠️ صفر أسرار في الرد: مفيش receiptToken ولا receiptPath ولا itemCount.
 *    السر الخام بيتسلّم في Set-Cookie بس، في نفس استجابة POST /api/orders.
 */

/** صنف متر (lengthCm ± widthCm) أو صنف قطعة (quantity) — واحد بس منهم. */
export type OrderItemInput = {
  productId: number
  lengthCm?: number
  /** 0015 — العرض المختار؛ ناقص = العرض الأساسي. */
  widthCm?: number
  /** 0016 — عدد القطع لمنتج القطعة. */
  quantity?: number
}

export type OrderRequest = {
  customerName: string
  customerPhone: string
  governorate: string
  address: string
  notes: string | null
  items: OrderItemInput[]
}

export type OrderSuccess = {
  ok: true
  order: {
    orderNumber: string
    subtotalPiastres: number
    shippingPiastres: number
    totalPiastres: number
    replayed: boolean
  }
}

export type OrderFailure = {
  ok: false
  code: OrderErrorCode
  message: string
  retryable: boolean
}

export type OrderResponse = OrderSuccess | OrderFailure

/** نتيجة zell_create_order الخام — أسماء snake_case زي ما الداتابيز بترجّعها. */
export type CreateOrderResult = {
  ok: boolean
  replayed: boolean
  order_number: string
  subtotal_piastres: number
  shipping_piastres: number
  total_piastres: number
  /**
   * بيتكتب مرة واحدة عند الإنشاء و**ما بيتمدّش** — لا على replay ولا غيره.
   * الراوت بيحسب منه Max-Age المتبقي للكوكي (§6.4ب). مضاف في 0006c.
   */
  receipt_expires_at: string
}

/** إسقاط الإيصال المقنّع — zell_get_order_receipt. */
export type ReceiptItem = {
  product_name_ar: string
  length_cm: number | null
  width_cm: number | null
  line_total_piastres: number
  /** 0016 */
  quantity?: number
  sale_unit?: string
}

export type Receipt = {
  order_number: string
  created_at: string
  governorate: string
  first_name: string
  phone_last4: string
  subtotal_piastres: number
  shipping_piastres: number
  total_piastres: number
  items: ReceiptItem[]
}

export type OrderErrorCode =
  | 'ORDERS_DISABLED'
  | 'BAD_ORIGIN'
  | 'BAD_CONTENT_TYPE'
  | 'BODY_TOO_LARGE'
  | 'BAD_JSON'
  | 'CHECKOUT_SESSION_MISSING'
  | 'IDEMPOTENCY_REQUIRED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'REPLAY_NOT_AUTHORIZED'
  | 'CART_EMPTY'
  | 'CART_TOO_LARGE'
  | 'CART_INVALID'
  | 'INVALID_NAME'
  | 'INVALID_PHONE'
  | 'INVALID_ADDRESS'
  | 'NOTES_TOO_LONG'
  | 'GOVERNORATE_NOT_SERVED'
  | 'ITEM_UNAVAILABLE'
  | 'CONCURRENT_SUBMIT'
  | 'PHONE_DAILY_LIMIT'
  | 'SETTINGS_MISSING'
  | 'PRICE_OUT_OF_RANGE'
  | 'ORDER_NUMBER_EXHAUSTED'
  | 'INTERNAL'
