import 'server-only'

import { FORBIDDEN_MESSAGE, UNAUTHENTICATED_MESSAGE } from '../access/wrappers'
import { ORDER_CANCELLED_FINAL_MESSAGE } from '../enums'
import type { MutationResult } from '../mutations'
import {
  CALL_NOTE_MAX,
  DELIVERY_NOTE_MAX,
  FOLLOW_UP_TEXT,
  NO_CHANGES_MESSAGE,
  ORDER_CONFLICT_MESSAGE,
  ORDER_INTERNAL_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
  PHONE_RE,
  isCallOutcome,
  isDeliveryPeriod,
  orderFailureKind,
  parseWriteResult,
} from '../orders/cycle'
import { callOrderRpc, type OrderFunction } from '../orders/rpc'
import { validateInternalNote, validateOrderId, validateOrderStatus } from '../validation/order'
import { invalid, optionalText, timestamp, type ValidationFailure } from '../validation/shared'

/**
 * 0021-A A2 — كتابات الطلب بقت نداءات لدوال zell_order_* بجلسة المستخدم (بدل PATCH بـ service_role).
 *
 *   • الدالة بتقفل صف الطلب، وبتفحص updated_at بدقة الميلي ثانية (زي patchGuarded)، وبتكتب الحدث في نفس المعاملة.
 *   • النصوص في لوحة الطلبات من lib/orders/cycle.ts (تحسين النصوص بعد A2): التعارض والطلب غير الموجود والخطأ العام
 *     والإلغاء النهائي (45080). من غير جلسة / مش مصرّح = ثوابت الأغلفة زي ما هي. مفيش أي تفصيلة من Supabase بتطلع.
 *   • التحقق هنا مبدئي؛ القرار النهائي في الداتابيز.
 */

function internalFailure(): MutationResult<never> {
  return { ok: false, code: 'INTERNAL', message: ORDER_INTERNAL_MESSAGE }
}

function failureFrom(error: unknown, status: number): MutationResult<never> {
  const failure = orderFailureKind(error, status)
  switch (failure.kind) {
    case 'unauthenticated':
      return { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }
    case 'forbidden':
      return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }
    case 'not_found':
      return { ok: false, code: 'NOT_FOUND', message: ORDER_NOT_FOUND_MESSAGE }
    case 'conflict':
      return { ok: false, code: 'CONFLICT', message: ORDER_CONFLICT_MESSAGE }
    case 'cancelled_final':
      return { ok: false, code: 'VALIDATION', message: ORDER_CANCELLED_FINAL_MESSAGE }
    case 'validation':
      return { ok: false, code: 'VALIDATION', message: failure.message }
    default:
      return internalFailure()
  }
}

async function writeOrder(fn: OrderFunction, args: Record<string, unknown>): Promise<MutationResult<null>> {
  const response = await callOrderRpc(fn, args)
  if (response === null) return internalFailure()
  if (response.error !== null && response.error !== undefined) return failureFrom(response.error, response.status)
  // رد بشكل غير متوقع = خطأ غير متوقع (الكتابة ممكن تكون حصلت، والواجهة بتعمل تحديث).
  if (parseWriteResult(response.data) === null) return internalFailure()
  return { ok: true, data: null }
}

function stampOf(raw: unknown): { ok: true; value: string } | ValidationFailure {
  return timestamp(raw, 'طابع آخر تعديل')
}

function isoOrNull(raw: unknown, label: string): { ok: true; value: string | null } | ValidationFailure {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw))) return invalid(label + ' غير صالح')
  return { ok: true, value: new Date(Date.parse(raw)).toISOString() }
}

/** تغيير الحالة — بالجدول (order_status_transitions) والبوابة. */
export async function updateOrderStatus(rawOrderId: unknown, rawStatus: unknown, rawStamp: unknown): Promise<MutationResult<null>> {
  const orderId = validateOrderId(rawOrderId)
  if (!orderId.ok) return orderId
  const status = validateOrderStatus(rawStatus)
  if (!status.ok) return status
  const stamp = stampOf(rawStamp)
  if (!stamp.ok) return stamp
  return writeOrder('transition', { p_order_id: orderId.value, p_expected_updated_at: stamp.value, p_to: status.value, p_reason: null })
}

/**
 * الملاحظات الداخلية — للأدمن بس، ومابتظهرش للزبون في أي مكان.
 * بتستبدل النص كامل مش بتضيف عليه، وكل حفظ حدث note_changed.
 */
export async function saveInternalNote(rawOrderId: unknown, rawNote: unknown, rawStamp: unknown): Promise<MutationResult<null>> {
  const orderId = validateOrderId(rawOrderId)
  if (!orderId.ok) return orderId
  const note = validateInternalNote(rawNote)
  if (!note.ok) return note
  const stamp = stampOf(rawStamp)
  if (!stamp.ok) return stamp
  return writeOrder('setInternalNote', { p_order_id: orderId.value, p_expected_updated_at: stamp.value, p_note: note.value })
}

/** محاولة اتصال بنتيجة من السبعة. «يتكلم بعدين» لازم معاها معاد متابعة، والباقي من غيره. */
export async function recordOrderCall(
  rawOrderId: unknown,
  rawOutcome: unknown,
  rawNote: unknown,
  rawFollowUpAt: unknown,
  rawStamp: unknown,
): Promise<MutationResult<null>> {
  const orderId = validateOrderId(rawOrderId)
  if (!orderId.ok) return orderId
  if (!isCallOutcome(rawOutcome)) return invalid('نتيجة التواصل غير معروفة')
  const note = optionalText(rawNote, 'ملاحظة التواصل', CALL_NOTE_MAX)
  if (!note.ok) return note
  const followUp = isoOrNull(rawFollowUpAt, 'موعد المتابعة')
  if (!followUp.ok) return followUp
  if (rawOutcome === 'callback_later' && followUp.value === null) return invalid(FOLLOW_UP_TEXT.missing)
  if (rawOutcome !== 'callback_later' && followUp.value !== null) return invalid('موعد المتابعة متاح مع «متابعة لاحقًا» فقط.')
  const stamp = stampOf(rawStamp)
  if (!stamp.ok) return stamp
  return writeOrder('recordCall', {
    p_order_id: orderId.value,
    p_expected_updated_at: stamp.value,
    p_outcome: rawOutcome,
    p_note: note.value,
    p_follow_up_at: followUp.value,
  })
}

/** تعديل أو مسح معاد المتابعة (null = مسح). */
export async function setOrderFollowUp(rawOrderId: unknown, rawFollowUpAt: unknown, rawNote: unknown, rawStamp: unknown): Promise<MutationResult<null>> {
  const orderId = validateOrderId(rawOrderId)
  if (!orderId.ok) return orderId
  const followUp = isoOrNull(rawFollowUpAt, 'موعد المتابعة')
  if (!followUp.ok) return followUp
  const note = optionalText(rawNote, 'ملاحظة المتابعة', CALL_NOTE_MAX)
  if (!note.ok) return note
  const stamp = stampOf(rawStamp)
  if (!stamp.ok) return stamp
  return writeOrder('setFollowUp', {
    p_order_id: orderId.value,
    p_expected_updated_at: stamp.value,
    p_follow_up_at: followUp.value,
    p_note: note.value,
  })
}

/** معاد التسليم المؤكد: تاريخ + فترة (اختيارية) + ملاحظة. من غير تاريخ = مسح. */
export async function setOrderDelivery(rawOrderId: unknown, rawValue: unknown, rawStamp: unknown): Promise<MutationResult<null>> {
  const orderId = validateOrderId(rawOrderId)
  if (!orderId.ok) return orderId
  if (typeof rawValue !== 'object' || rawValue === null) return invalid('موعد التسليم غير صالح.')
  const value = rawValue as { date?: unknown; period?: unknown; note?: unknown }
  const date = value.date === null || value.date === undefined ? null : value.date
  if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return invalid('تاريخ التسليم غير صالح.')
  const period = value.period === null || value.period === undefined ? null : value.period
  if (period !== null && !isDeliveryPeriod(period)) return invalid('الفترة المختارة غير متاحة.')
  const note = optionalText(value.note, 'ملاحظة التسليم', DELIVERY_NOTE_MAX)
  if (!note.ok) return note
  if (date === null && (period !== null || note.value !== null)) return invalid('حدد تاريخ التسليم أولًا، أو احذف الفترة والملاحظة.')
  const stamp = stampOf(rawStamp)
  if (!stamp.ok) return stamp
  return writeOrder('setConfirmedDelivery', {
    p_order_id: orderId.value,
    p_expected_updated_at: stamp.value,
    p_date: date,
    p_period: period,
    p_note: note.value,
  })
}

const DETAIL_KEYS = ['customer_name', 'customer_phone', 'address', 'notes'] as const

/** تعديل بيانات الزبون في «جديد» بس: الاسم والعنوان والملاحظات، والموبايل لو الطلب من غير كوبون (الداتابيز بتتأكد). */
export async function editOrderDetails(rawOrderId: unknown, rawChanges: unknown, rawStamp: unknown): Promise<MutationResult<null>> {
  const orderId = validateOrderId(rawOrderId)
  if (!orderId.ok) return orderId
  if (typeof rawChanges !== 'object' || rawChanges === null || Array.isArray(rawChanges)) return invalid('التعديلات غير صالحة.')
  const entries = Object.entries(rawChanges as Record<string, unknown>)
  if (entries.length === 0) return invalid(NO_CHANGES_MESSAGE)
  const changes: Record<string, string | null> = {}
  for (const [key, value] of entries) {
    if (!(DETAIL_KEYS as readonly string[]).includes(key)) return invalid('التعديلات غير صالحة.')
    if (key === 'notes') {
      const notes = optionalText(value, 'ملاحظات العميل', 500)
      if (!notes.ok) return notes
      changes[key] = notes.value
      continue
    }
    if (typeof value !== 'string' || value.trim() === '') return invalid('التعديلات غير صالحة.')
    if (key === 'customer_phone' && !PHONE_RE.test(value.trim())) return invalid('رقم الهاتف غير صالح.')
    changes[key] = value.trim()
  }
  const stamp = stampOf(rawStamp)
  if (!stamp.ok) return stamp
  return writeOrder('editDetails', { p_order_id: orderId.value, p_expected_updated_at: stamp.value, p_changes: changes })
}
