/**
 * 0021-A P1 — رسوم تأكيد الطلب (§٣-٣ من docs/contracts/0021-A.md): دفعة مقدمة من نفس الإجمالي، مش خصم.
 *
 *   • الداتابيز هي الحكم: لقطة confirmation_fee_piastres بتتحسب في zell_create_order بـ public.zell_payment_fee_calc،
 *     والمتصفح عمره ما يبعتها. الحساب هنا مطابق بالحرف (للعرض في Checkout واللوحة — P2)، و CI بيقارن الاتنين على
 *     آلاف الحالات (backend/db/ci/0021p1_fee_parity.mjs).
 *   • الملف من غير imports علشان يتشغّل في CI بـ node --experimental-strip-types.
 *
 * الحساب: الأساس total_piastres النهائي (أصناف − خصم + شحن + تركيب + انتقال).
 *   النطاق: all · made_to_measure (فيه صنف بالمقاس) · with_installation · above_amount (total >= الحد).
 *   الطريقة: shipping (قيمة الشحن، ولو صفر = البديل) · fixed · percent = ceil(total × bp ÷ 1,000,000) × 100
 *   (النسبة بوحدة 0.01% — 1000 = 10% — والتقريب لأقرب جنيه لفوق للنسبة بس).
 *   الكل بحد أقصى الإجمالي، وبرّه النطاق أو مقفول = 0. أي قيمة مش صالحة = كأنها مش موجودة.
 */

export const CONFIRMATION_FEE_SCOPES = ['all', 'made_to_measure', 'with_installation', 'above_amount'] as const
export type ConfirmationFeeScope = (typeof CONFIRMATION_FEE_SCOPES)[number]

export const CONFIRMATION_FEE_METHODS = ['shipping', 'fixed', 'percent'] as const
export type ConfirmationFeeMethod = (typeof CONFIRMATION_FEE_METHODS)[number]

/** أقصى نسبة بوحدة 0.01% (= 100%). */
export const CONFIRMATION_FEE_PERCENT_BP_MAX = 10000
/** أقصى مبلغ في الإعداد بالقرش (ثابت · بديل الشحن · الحد). */
export const CONFIRMATION_FEE_AMOUNT_MAX = 100000000

/** نفس شكل public.zell_payment_settings.confirmation_fee. */
export type ConfirmationFeeConfig = {
  enabled: boolean
  scope?: ConfirmationFeeScope
  method?: ConfirmationFeeMethod
  percent_bp?: number
  fixed_piastres?: number
  shipping_fallback_piastres?: number
  threshold_piastres?: number
}

export type ConfirmationFeeOrder = {
  totalPiastres: number
  shippingPiastres: number
  madeToMeasure: boolean
  installation: boolean
}

function configInt(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null
  return value >= 1 && value <= max ? value : null
}

/** المطلوب مقدمًا بالقرش (0 لو مقفول أو الطلب برّه النطاق). */
export function confirmationFeePiastres(
  config: Readonly<Record<string, unknown>> | ConfirmationFeeConfig | null | undefined,
  order: ConfirmationFeeOrder,
): number {
  const total = order.totalPiastres
  if (!config || config['enabled'] !== true || !Number.isSafeInteger(total) || total <= 0) return 0
  const threshold = configInt(config['threshold_piastres'], CONFIRMATION_FEE_AMOUNT_MAX)
  let inScope = false
  switch (config['scope']) {
    case 'all':
      inScope = true
      break
    case 'made_to_measure':
      inScope = order.madeToMeasure === true
      break
    case 'with_installation':
      inScope = order.installation === true
      break
    case 'above_amount':
      inScope = threshold !== null && total >= threshold
      break
    default:
      inScope = false
  }
  if (!inScope) return 0
  let fee = 0
  switch (config['method']) {
    case 'shipping':
      fee = order.shippingPiastres > 0
        ? order.shippingPiastres
        : (configInt(config['shipping_fallback_piastres'], CONFIRMATION_FEE_AMOUNT_MAX) ?? 0)
      break
    case 'fixed':
      fee = configInt(config['fixed_piastres'], CONFIRMATION_FEE_AMOUNT_MAX) ?? 0
      break
    case 'percent': {
      const bp = configInt(config['percent_bp'], CONFIRMATION_FEE_PERCENT_BP_MAX) ?? 0
      const n = total * bp
      fee = ((n - (n % 1000000)) / 1000000 + (n % 1000000 === 0 ? 0 : 1)) * 100
      break
    }
    default:
      fee = 0
  }
  return Math.min(Math.max(fee, 0), total)
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

/** حالة الدفع المشتقة (§٣-٢): مدفوع = الإجمالي كله، مش مدفوع = 0، غير كده جزئي. نفس zell_payment_summary. */
export function paymentStatus(totalPiastres: number, paidPiastres: number): PaymentStatus {
  if (paidPiastres >= totalPiastres) return 'paid'
  return paidPiastres === 0 ? 'unpaid' : 'partial'
}
