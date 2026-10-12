import 'server-only'

import { FORBIDDEN_MESSAGE, UNAUTHENTICATED_MESSAGE } from '../access/wrappers'
import type { MutationResult } from '../mutations'
import { ORDER_CONFLICT_MESSAGE, ORDER_INTERNAL_MESSAGE } from '../orders/cycle'
import {
  DELIVERY_FIELD_MESSAGES,
  deliverySettingsFailureKind,
  deliverySettingsIssue,
  normalizeDeliveryNote,
  parseDeliverySettings,
  type DeliverySettingsInput,
} from '../orders/deliverySettings'
import { callOrderRpc } from '../orders/rpc'
import { invalid, timestamp } from '../validation/shared'

/**
 * 0021-D2 — حفظ إعداد موعد التسليم (zell_delivery_settings_save) بجلسة المستخدم: مفيش service_role ولا معامل ممثل.
 * المالك بس (الغلاف في lib/orderActions.ts، والقرار النهائي في الداتابيز 45402). التحقق هنا مبدئي بنفس قواعد الداتابيز.
 */
export async function saveDeliverySettings(input: DeliverySettingsInput): Promise<MutationResult<null>> {
  if (typeof input !== 'object' || input === null) return invalid('البيانات غير صالحة.')
  const stamp = timestamp(input.expectedUpdatedAt, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp
  if (typeof input.customerChoiceEnabled !== 'boolean') return invalid(DELIVERY_FIELD_MESSAGES['customer_choice_enabled'] as string)
  if (typeof input.noteEnabled !== 'boolean') return invalid(DELIVERY_FIELD_MESSAGES['note_enabled'] as string)
  if (typeof input.noteText !== 'string') return invalid(DELIVERY_FIELD_MESSAGES['note_text'] as string)
  const issue = deliverySettingsIssue({
    customerChoiceEnabled: input.customerChoiceEnabled,
    noteEnabled: input.noteEnabled,
    noteText: input.noteText,
  })
  if (issue !== null) return invalid(issue)

  const response = await callOrderRpc('saveDeliverySettings', {
    p_expected_updated_at: stamp.value,
    p_customer_choice_enabled: input.customerChoiceEnabled,
    p_note_enabled: input.noteEnabled,
    p_note_text: normalizeDeliveryNote(input.noteText),
  })
  if (response === null) return { ok: false, code: 'INTERNAL', message: ORDER_INTERNAL_MESSAGE }
  if (response.error !== null && response.error !== undefined) {
    const failure = deliverySettingsFailureKind(response.error, response.status)
    switch (failure.kind) {
      case 'unauthenticated':
        return { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }
      case 'forbidden':
        return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }
      case 'conflict':
        return { ok: false, code: 'CONFLICT', message: ORDER_CONFLICT_MESSAGE }
      case 'validation':
        return { ok: false, code: 'VALIDATION', message: failure.message }
      default:
        return { ok: false, code: 'INTERNAL', message: ORDER_INTERNAL_MESSAGE }
    }
  }
  // رد غير متوقع: الحفظ ممكن يكون حصل، والواجهة بتعمل تحديث وتقرا تاني من الداتابيز.
  if (parseDeliverySettings(response.data) === null) return { ok: false, code: 'INTERNAL', message: ORDER_INTERNAL_MESSAGE }
  return { ok: true, data: null }
}
