import 'server-only'

import { ORDER_STATUSES, type OrderStatus } from '../enums'
import { invalid, optionalText, wholeNumber, type ValidationFailure } from './shared'

/** نفس قيد orders_internal_notes_length بالظبط. */
const MAX_NOTE_LENGTH = 2000

export function validateOrderId(value: unknown): { ok: true; value: number } | ValidationFailure {
  const id = wholeNumber(value, 'معرّف الطلب')
  if (!id.ok) return id
  if (id.value <= 0) return invalid('معرّف الطلب غير صالح')
  return { ok: true, value: id.value }
}

/** نفس قيد orders_status_check بالظبط. */
export function validateOrderStatus(value: unknown): { ok: true; value: OrderStatus } | ValidationFailure {
  if (typeof value !== 'string') return invalid('حالة الطلب غير معروفة')
  if (!(ORDER_STATUSES as readonly string[]).includes(value)) return invalid('حالة الطلب غير معروفة')
  return { ok: true, value: value as OrderStatus }
}

/** الملاحظات الداخلية — للأدمن بس، والفاضي بيتحوّل null. */
export function validateInternalNote(value: unknown): { ok: true; value: string | null } | ValidationFailure {
  return optionalText(value, 'الملاحظات الداخلية', MAX_NOTE_LENGTH)
}
