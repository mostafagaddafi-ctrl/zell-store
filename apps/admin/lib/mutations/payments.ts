import 'server-only'

import { FORBIDDEN_MESSAGE, UNAUTHENTICATED_MESSAGE } from '../access/wrappers'
import type { MutationResult } from '../mutations'
import { ORDER_CONFLICT_MESSAGE, ORDER_INTERNAL_MESSAGE, ORDER_NOT_FOUND_MESSAGE } from '../orders/cycle'
import {
  FEE_POLICY_MAX,
  METHOD_NAME_MAX,
  PAYMENT_FIELD_MESSAGES,
  PAYMENT_NOTE_MAX,
  PAYMENT_NUMBERS_MAX,
  PAYMENT_PURPOSES,
  PAYMENT_REFERENCE_MAX,
  WHATSAPP_TEMPLATE_MAX,
  parseMethods,
  parsePaymentSummary,
  parseSettings,
  paymentFailureKind,
  type FeeConfig,
  type PaymentPurpose,
} from '../orders/payments'
import { callOrderRpc, type OrderFunction } from '../orders/rpc'
import { validateOrderId } from '../validation/order'
import { invalid, optionalText, timestamp, type ValidationFailure } from '../validation/shared'

/**
 * 0021-A P2 — كتابات الدفعات (zell_payment_*) بجلسة المستخدم، زي دورة الطلب في A2: مفيش service_role ولا معامل ممثل،
 * والقرار النهائي (المبالغ · الحالة · المقدم · الباقي · الآجل · الصلاحية) في الداتابيز. التحقق هنا مبدئي بس.
 * كل كتابة فلوس معاها command_id (UUID من «نية الكتابة» في الواجهة)، فإعادة نفس الطلب مابتسجّلش مرتين.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INT4_MAX = 2147483647

function internalFailure(): MutationResult<never> {
  return { ok: false, code: 'INTERNAL', message: ORDER_INTERNAL_MESSAGE }
}

function failureFrom(error: unknown, status: number): MutationResult<never> {
  const failure = paymentFailureKind(error, status)
  switch (failure.kind) {
    case 'unauthenticated':
      return { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }
    case 'forbidden':
      return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }
    case 'not_found':
      return { ok: false, code: 'NOT_FOUND', message: ORDER_NOT_FOUND_MESSAGE }
    case 'conflict':
      return { ok: false, code: 'CONFLICT', message: ORDER_CONFLICT_MESSAGE }
    case 'validation':
      return { ok: false, code: 'VALIDATION', message: failure.message }
    default:
      return internalFailure()
  }
}

/** النداء + التحقق من شكل الرد. parse = null ← رد غير متوقع (الكتابة ممكن تكون حصلت، والواجهة بتعمل تحديث). */
async function write(fn: OrderFunction, args: Record<string, unknown>, parse: (raw: unknown) => unknown): Promise<MutationResult<null>> {
  const response = await callOrderRpc(fn, args)
  if (response === null) return internalFailure()
  if (response.error !== null && response.error !== undefined) return failureFrom(response.error, response.status)
  if (parse(response.data) === null) return internalFailure()
  return { ok: true, data: null }
}

function field(key: string): ValidationFailure {
  return invalid(PAYMENT_FIELD_MESSAGES[key] ?? 'البيانات غير صالحة.')
}

function commandOf(raw: unknown): { ok: true; value: string } | ValidationFailure {
  return typeof raw === 'string' && UUID_RE.test(raw) ? { ok: true, value: raw.toLowerCase() } : invalid('حدّث الصفحة وحاول مرة أخرى.')
}

function amountOf(raw: unknown): { ok: true; value: number } | ValidationFailure {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 1 && raw <= INT4_MAX ? { ok: true, value: raw } : field('amount_piastres')
}

type MethodChoice = { methodId: number | null; methodOther: string | null }

function methodOf(rawId: unknown, rawOther: unknown): { ok: true; value: MethodChoice } | ValidationFailure {
  const other = typeof rawOther === 'string' ? rawOther.trim() : ''
  if (rawId === null || rawId === undefined) {
    if (other === '') return field('method')
    if (other.length > METHOD_NAME_MAX) return field('method_other')
    return { ok: true, value: { methodId: null, methodOther: other } }
  }
  if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId) || rawId <= 0 || other !== '') return field('method')
  return { ok: true, value: { methodId: rawId, methodOther: null } }
}

export type PaymentInput = {
  orderId: number
  commandId: string
  expectedUpdatedAt: string
  amountPiastres: number
  purpose: PaymentPurpose
  methodId: number | null
  methodOther: string
  reference: string
  note: string
}

/** تسجيل دفعة (الأدمن والمالك) أو رد (المالك — الداتابيز بتتأكد كمان). */
export async function writePayment(kind: 'payment' | 'refund', input: PaymentInput): Promise<MutationResult<null>> {
  const orderId = validateOrderId(input.orderId)
  if (!orderId.ok) return orderId
  const command = commandOf(input.commandId)
  if (!command.ok) return command
  const stamp = timestamp(input.expectedUpdatedAt, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp
  const amount = amountOf(input.amountPiastres)
  if (!amount.ok) return amount
  if (!(PAYMENT_PURPOSES as readonly unknown[]).includes(input.purpose)) return field('purpose')
  const method = methodOf(input.methodId, input.methodOther)
  if (!method.ok) return method
  const reference = optionalText(input.reference, 'رقم العملية', PAYMENT_REFERENCE_MAX)
  if (!reference.ok) return field('reference')
  const note = optionalText(input.note, 'الملاحظة', PAYMENT_NOTE_MAX)
  if (!note.ok) return field('note')
  return write(kind === 'payment' ? 'recordPayment' : 'refundPayment', {
    p_command_id: command.value,
    p_order_id: orderId.value,
    p_expected_updated_at: stamp.value,
    p_amount_piastres: amount.value,
    p_purpose: input.purpose,
    p_method_id: method.value.methodId,
    p_method_other: method.value.methodOther,
    p_reference: reference.value,
    p_note: note.value,
  }, parsePaymentSummary)
}

export type DeliverInput = {
  orderId: number
  commandId: string
  expectedUpdatedAt: string
  /** null = من غير تحصيل (بيعدّي بس لو الباقي صفر، أو آجل صريح). */
  amountPiastres: number | null
  methodId: number | null
  methodOther: string
  reference: string
  onCredit: boolean
}

/** التسليم مع التحصيل في نفس المعاملة، أو آجل صريح (§٣-٤). */
export async function deliverOrder(input: DeliverInput): Promise<MutationResult<null>> {
  const orderId = validateOrderId(input.orderId)
  if (!orderId.ok) return orderId
  const command = commandOf(input.commandId)
  if (!command.ok) return command
  const stamp = timestamp(input.expectedUpdatedAt, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp
  if (typeof input.onCredit !== 'boolean') return invalid('البيانات غير صالحة.')
  let args: Record<string, unknown> = {
    p_command_id: command.value,
    p_order_id: orderId.value,
    p_expected_updated_at: stamp.value,
    p_on_credit: input.onCredit,
  }
  if (input.amountPiastres !== null) {
    const amount = amountOf(input.amountPiastres)
    if (!amount.ok) return amount
    const method = methodOf(input.methodId, input.methodOther)
    if (!method.ok) return method
    const reference = optionalText(input.reference, 'رقم العملية', PAYMENT_REFERENCE_MAX)
    if (!reference.ok) return field('reference')
    args = { ...args, p_amount_piastres: amount.value, p_method_id: method.value.methodId, p_method_other: method.value.methodOther, p_reference: reference.value }
  }
  return write('deliverOrder', args, parsePaymentSummary)
}

// ── طرق الدفع (المالك) ──────────────────────────────────────────────────
function methodNameOf(raw: unknown): { ok: true; value: string } | ValidationFailure {
  const name = typeof raw === 'string' ? raw.trim() : ''
  return name === '' || name.length > METHOD_NAME_MAX ? field('name') : { ok: true, value: name }
}

function sortOf(raw: unknown): { ok: true; value: number } | ValidationFailure {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 && raw <= 100000 ? { ok: true, value: raw } : field('sort_order')
}

function idOf(raw: unknown): { ok: true; value: number } | ValidationFailure {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? { ok: true, value: raw } : invalid('حدّث الصفحة وحاول مرة أخرى.')
}

export async function addPaymentMethod(rawName: unknown): Promise<MutationResult<null>> {
  const name = methodNameOf(rawName)
  if (!name.ok) return name
  return write('addPaymentMethod', { p_name: name.value, p_sort_order: null }, parseMethods)
}

export async function updatePaymentMethod(rawId: unknown, rawStamp: unknown, rawName: unknown, rawSort: unknown, rawArchived: unknown): Promise<MutationResult<null>> {
  const id = idOf(rawId)
  if (!id.ok) return id
  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp
  const name = methodNameOf(rawName)
  if (!name.ok) return name
  const sort = sortOf(rawSort)
  if (!sort.ok) return sort
  if (typeof rawArchived !== 'boolean') return invalid('البيانات غير صالحة.')
  return write('updatePaymentMethod', {
    p_id: id.value, p_expected_updated_at: stamp.value, p_name: name.value, p_sort_order: sort.value, p_is_archived: rawArchived,
  }, parseMethods)
}

export async function deletePaymentMethod(rawId: unknown, rawStamp: unknown): Promise<MutationResult<null>> {
  const id = idOf(rawId)
  if (!id.ok) return id
  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp
  return write('deletePaymentMethod', { p_id: id.value, p_expected_updated_at: stamp.value }, parseMethods)
}

// ── إعدادات الدفع (المالك) ──────────────────────────────────────────────
export type SettingsInput = {
  expectedUpdatedAt: string
  fee: FeeConfig
  creditEnabled: boolean
  paymentNumbers: string
  feePolicy: string
  whatsappTemplate: string
}

export async function savePaymentSettings(input: SettingsInput): Promise<MutationResult<null>> {
  const stamp = timestamp(input.expectedUpdatedAt, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp
  if (typeof input.creditEnabled !== 'boolean') return field('customer_credit_enabled')
  if (typeof input.fee !== 'object' || input.fee === null || typeof input.fee.enabled !== 'boolean') return field('enabled')
  const numbers = optionalText(input.paymentNumbers, 'أرقام الدفع', PAYMENT_NUMBERS_MAX)
  if (!numbers.ok) return field('payment_numbers')
  const policy = optionalText(input.feePolicy, 'السياسة', FEE_POLICY_MAX)
  if (!policy.ok) return field('fee_policy')
  const template = optionalText(input.whatsappTemplate, 'قالب الرسالة', WHATSAPP_TEMPLATE_MAX)
  if (!template.ok) return field('whatsapp_template')
  return write('savePaymentSettings', {
    p_expected_updated_at: stamp.value,
    p_confirmation_fee: input.fee,
    p_customer_credit_enabled: input.creditEnabled,
    p_payment_numbers: numbers.value,
    p_fee_policy: policy.value,
    p_whatsapp_template: template.value,
  }, parseSettings)
}
