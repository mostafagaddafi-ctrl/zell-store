import { confirmationFeePiastres, type ConfirmationFeeOrder } from '@zell/core'

/**
 * 0021-A P2 — رسوم تأكيد الطلب في المتجر (للعرض بس): سطر Checkout («مطلوب X مقدمًا…») والإيصال (المطلوب · المدفوع · الباقي).
 *
 *   • الإعداد من الداتابيز (zell_checkout_confirmation_fee، service_role) — نفس الصف اللي zell_create_order بتاخد منه اللقطة.
 *   • الحساب من @zell/core (confirmationFeePiastres) = حساب الداتابيز بالحرف (CI بيقارن). المعتمد هو اللقطة على الطلب.
 *   • أي فشل أو إعداد مش موجود = مفيش سطر، والطلب مابيقعش.
 */
export type CheckoutFee = { config: Readonly<Record<string, unknown>>; policy: string | null }

export function parseCheckoutFee(raw: unknown): CheckoutFee | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const config = record['confirmation_fee']
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return null
  const policy = typeof record['fee_policy'] === 'string' && record['fee_policy'].trim() !== '' ? record['fee_policy'].trim() : null
  return { config: config as Record<string, unknown>, policy }
}

/** المقدم والباقي للطلب ده، أو null لو مفيش مقدم. */
export function checkoutFeeSplit(fee: CheckoutFee | null | undefined, order: ConfirmationFeeOrder): { fee: number; rest: number } | null {
  if (!fee) return null
  const value = confirmationFeePiastres(fee.config, order)
  return value > 0 ? { fee: value, rest: order.totalPiastres - value } : null
}

export const CHECKOUT_FEE_TEXT = {
  required: 'مطلوب مقدمًا لتأكيد الطلب',
  rest: 'والباقي عند الاستلام',
  note: 'هنتواصل معاك بطريقة الدفع، والطلب بيتأكد بعد استلام المقدم. المقدم جزء من الإجمالي، مش مبلغ زيادة.',
  receiptTitle: 'الدفع',
  receiptFee: 'المطلوب مقدمًا لتأكيد الطلب',
  receiptPaid: 'المدفوع',
  receiptRemaining: 'الباقي',
  receiptAwaiting: 'طلبك هيتأكد بعد استلام المقدم. هنكلّمك بطريقة الدفع.',
} as const

export type OrderMoney = { total: number; paid: number; fee: number }

export function parseOrderMoney(raw: unknown): OrderMoney | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const total = record['total_piastres']
  const paid = record['paid_piastres']
  const fee = record['confirmation_fee_piastres']
  if (typeof total !== 'number' || typeof paid !== 'number' || typeof fee !== 'number') return null
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(paid) || !Number.isSafeInteger(fee)) return null
  return { total, paid, fee }
}
