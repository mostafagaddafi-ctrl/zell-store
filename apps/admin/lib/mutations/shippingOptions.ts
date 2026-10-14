import 'server-only'

import { FORBIDDEN_MESSAGE, UNAUTHENTICATED_MESSAGE } from '../access/wrappers'
import type { MutationResult } from '../mutations'
import { ORDER_CONFLICT_MESSAGE, ORDER_INTERNAL_MESSAGE } from '../orders/cycle'
import { callOrderRpc } from '../orders/rpc'
import {
  parseShippingOptionsSettings,
  payloadIssue,
  shippingOptionsFailureKind,
  type ShippingOptionsInput,
} from '../orders/shippingOptions'
import { invalid, timestamp } from '../validation/shared'

/**
 * EXPRESS-SHIPPING W2 — حفظ إعداد مدة الشحن والشحن السريع (zell_shipping_options_save) بجلسة المستخدم: مفيش service_role
 * ولا معامل ممثل. المالك بس (الغلاف في lib/orderActions.ts، والقرار النهائي في الداتابيز 45402). التحقق هنا مبدئي بنفس
 * قواعد الداتابيز (45432)، والإعداد الحقيقي مابيتحفظش غير بضغطة «حفظ» من المالك.
 */
export async function saveShippingOptions(input: ShippingOptionsInput): Promise<MutationResult<null>> {
  if (typeof input !== 'object' || input === null) return invalid('البيانات غير صالحة.')
  const stamp = timestamp(input.expectedUpdatedAt, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp
  const issue = payloadIssue({ expressEnabled: input.expressEnabled, governorates: input.governorates })
  if (issue !== null) return invalid(issue)

  const response = await callOrderRpc('saveShippingOptions', {
    p_expected_updated_at: stamp.value,
    p_express_enabled: input.expressEnabled,
    p_governorates: input.governorates,
  })
  if (response === null) return { ok: false, code: 'INTERNAL', message: ORDER_INTERNAL_MESSAGE }
  if (response.error !== null && response.error !== undefined) {
    const failure = shippingOptionsFailureKind(response.error, response.status)
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
  if (parseShippingOptionsSettings(response.data) === null) return { ok: false, code: 'INTERNAL', message: ORDER_INTERNAL_MESSAGE }
  return { ok: true, data: null }
}
