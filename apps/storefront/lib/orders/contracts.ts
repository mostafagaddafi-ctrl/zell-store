/**
 * عقود مسار الطلب — ORDER-FLOW-PLAN.md §1.1 و§1.2.
 *
 * ⚠️ صفر أسرار في الرد: مفيش receiptToken ولا receiptPath ولا itemCount.
 *    السر الخام بيتسلّم في Set-Cookie بس، في نفس استجابة POST /api/orders.
 */

import type { CouponTerms, PreferredDelivery } from '@zell/core'

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
  /** 0018 — المنطقة من قايمة الشحن، معامل صريح (مابتتلزقش في العنوان). */
  area?: string
  /** 0018 — فني تركيب بالسعر. بيتبعت بس لو true والمنطقة متاحة. */
  installation?: true
  /** 0019 — كود الخصم بس، من غير أي مبلغ. الراوت بيطبّعه تاني بـnormalizeCouponCode؛ فاضي = مفيش. */
  couponCode?: string
  /** 0021-D — موعد التسليم المفضّل (اختياري). */
  preferredDelivery?: PreferredDelivery
}

export type OrderSuccess = {
  ok: true
  order: {
    orderNumber: string
    subtotalPiastres: number
    shippingPiastres: number
    totalPiastres: number
    /** 0018 — من الداتابيز (0 لو مفيش فني). */
    installationPiastres: number
    installationTravelPiastres: number
    /** 0019 — من لقطة الداتابيز (null و 0 لو مفيش كوبون). */
    couponCode: string | null
    discountPiastres: number
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
  /** 0018 — لقطة الفني والمنطقة (الطلب الجديد والـreplay). */
  shipping_area?: string | null
  installation_requested?: boolean
  installation_piastres?: number
  installation_travel_piastres?: number
  /** 0019 — لقطة الخصم (الطلب الجديد والـreplay) — مابتتحسبش تاني. */
  coupon_code?: string | null
  discount_piastres?: number
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
  /** 0018 — أرقام التركيب بس. المنطقة مش بترجع (جزء من العنوان). */
  installation_requested?: boolean
  installation_rate_piastres?: number | null
  installation_length_cm?: number | null
  installation_piastres?: number
  installation_travel_piastres?: number
  /** 0019 — null و 0 لو مفيش كوبون. */
  coupon_code?: string | null
  discount_piastres?: number
  /** 0021-D — «موعد مفضل — بانتظار التأكيد» (null من غير موعد). */
  preferred_delivery?: { date: string; period: string | null; note: string | null } | null
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
  | 'PREFERRED_DELIVERY_INVALID'
  | 'INVALID_NAME'
  | 'INVALID_PHONE'
  | 'INVALID_ADDRESS'
  | 'NOTES_TOO_LONG'
  | 'GOVERNORATE_NOT_SERVED'
  | 'AREA_INVALID'
  | 'INSTALLATION_NOT_AVAILABLE'
  | 'INSTALLATION_NO_METERS'
  | 'ITEM_UNAVAILABLE'
  | 'CONCURRENT_SUBMIT'
  | 'PHONE_DAILY_LIMIT'
  | 'COUPON_INVALID'
  | 'COUPON_EXPIRED'
  | 'COUPON_EXHAUSTED'
  | 'COUPON_MIN_SUBTOTAL'
  | 'COUPON_PHONE_LIMIT'
  | 'COUPON_NOT_APPLICABLE'
  | 'COUPONS_DISABLED'
  | 'SETTINGS_MISSING'
  | 'PRICE_OUT_OF_RANGE'
  | 'ORDER_NUMBER_EXHAUSTED'
  | 'INTERNAL'

/** 0019 — أكواد رد POST /api/coupons/preview (المعاينة مابتفحصش الموبايل ولا الحد الأدنى). */
export type CouponPreviewErrorCode = Extract<
  OrderErrorCode,
  | 'ORDERS_DISABLED'
  | 'BAD_ORIGIN'
  | 'BAD_CONTENT_TYPE'
  | 'BODY_TOO_LARGE'
  | 'BAD_JSON'
  | 'CHECKOUT_SESSION_MISSING'
  | 'COUPONS_DISABLED'
  | 'COUPON_INVALID'
  | 'COUPON_EXPIRED'
  | 'COUPON_EXHAUSTED'
  | 'INTERNAL'
>

/** شروط الكوبون بس (camelCase) — مفيش id ولا عدّادات ولا تواريخ ولا ملاحظات ولا مبلغ خصم جاهز. */
export type CouponPreviewResponse = { ok: true; coupon: CouponTerms } | OrderFailure
