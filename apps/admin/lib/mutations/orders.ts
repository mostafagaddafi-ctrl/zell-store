import 'server-only'

import { sentinelOf } from '../data/client'
import { ORDER_CANCELLED_FINAL_MESSAGE } from '../enums'
import type { MutationResult } from '../mutations'
import { validateInternalNote, validateOrderId, validateOrderStatus } from '../validation/order'
import { timestamp } from '../validation/shared'
import { patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'

const TABLE = 'orders'

export async function updateOrderStatus(
  rawOrderId: unknown,
  rawStatus: unknown,
  rawStamp: unknown,
): Promise<MutationResult<null>> {
  const orderId = validateOrderId(rawOrderId)
  if (!orderId.ok) return orderId

  const status = validateOrderStatus(rawStatus)
  if (!status.ok) return status

  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  try {
    const result = await patchGuarded<{ id: number }>({
      table: TABLE,
      idColumn: 'id',
      idValue: orderId.value,
      expectedUpdatedAt: stamp.value,
      changes: { status: status.value },
      select: 'id',
    })
    if (!result.ok) return result
    return { ok: true, data: null }
  } catch (error) {
    // 0019 — الإلغاء نهائي في الداتابيز (45080): رسالة عربية واضحة بدل «خطأ غير متوقع»
    if (sentinelOf(error) === 'ZELL_ORDER_CANCELLED_FINAL') {
      return { ok: false, code: 'VALIDATION', message: ORDER_CANCELLED_FINAL_MESSAGE }
    }
    return toInternalFailure(error)
  }
}

/**
 * الملاحظات الداخلية — للأدمن بس، ومابتظهرش للزبون في أي مكان.
 * بتستبدل النص كامل مش بتضيف عليه.
 */
export async function saveInternalNote(
  rawOrderId: unknown,
  rawNote: unknown,
  rawStamp: unknown,
): Promise<MutationResult<null>> {
  const orderId = validateOrderId(rawOrderId)
  if (!orderId.ok) return orderId

  const note = validateInternalNote(rawNote)
  if (!note.ok) return note

  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  try {
    const result = await patchGuarded<{ id: number }>({
      table: TABLE,
      idColumn: 'id',
      idValue: orderId.value,
      expectedUpdatedAt: stamp.value,
      changes: { internal_notes: note.value },
      select: 'id',
    })
    if (!result.ok) return result
    return { ok: true, data: null }
  } catch (error) {
    return toInternalFailure(error)
  }
}
