import 'server-only'

import { FORBIDDEN_MESSAGE, UNAUTHENTICATED_MESSAGE } from '../access/wrappers'
import { ORDER_CANCELLED_FINAL_MESSAGE } from '../enums'
import type { MutationResult } from '../mutations'
import { ORDER_INTERNAL_MESSAGE, ORDER_NOT_FOUND_MESSAGE, type OrderFailureKind } from '../orders/cycle'
import { callOrderRpc, type OrderFunction, type OrderRpcResponse } from '../orders/rpc'
import {
  LAST_ID_MESSAGE,
  ORDER_NUMBER_MESSAGE,
  STAMP_MESSAGE,
  TRACK_CONFLICT_MESSAGE,
  UPDATE_FIELD_MESSAGES,
  UPDATE_ID_MESSAGE,
  UPDATE_NOT_FOUND_MESSAGE,
  isOrderNumber,
  isStamp,
  isUpdateId,
  parseShipmentSaved,
  parseUpdatesWritten,
  shipmentFailureKind,
  shipmentPayload,
  updateFailureKind,
  updateText,
  type ShipmentForm,
  type TrackWriteOutcome,
} from '../orders/trackUpdates'
import { invalid } from '../validation/shared'

/**
 * TRACK-ORDER v2 W2-B — كتابة الشحنة (zell_shipment_save) ورسائل العميل (zell_customer_update_add / _edit / _set_hidden) بجلسة
 * المستخدم: مفيش service_role ولا معامل ممثل. الأغلفة في lib/orderActions.ts (الشحنة zell.orders.status_edit · الرسايل
 * zell.orders.note_edit)، والقرار النهائي في الداتابيز. التحقق هنا مبدئي بنفس القواعد (lib/orders/trackUpdates.ts).
 *
 * كل نداء بنسخة: إعادة نفس النداء بعد ما كتب فعلًا = 45404 (مفيش تكرار)، والكارت بيعيد القراية ومابيبعتش تاني لوحده.
 * الحفظ بنفس القيم = changed = false من غير كتابة. النتيجة { changed, version } (النسخة بعد الكتابة، لنسخة بداية المسودة). رد غير متوقع = INTERNAL (الكتابة ممكن تكون حصلت، والكارت بيعمل تحديث).
 */

function internalFailure(): MutationResult<never> {
  return { ok: false, code: 'INTERNAL', message: ORDER_INTERNAL_MESSAGE }
}

function failureFrom(failure: OrderFailureKind, notFoundMessage: string): MutationResult<never> {
  switch (failure.kind) {
    case 'unauthenticated':
      return { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }
    case 'forbidden':
      return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }
    case 'not_found':
      return { ok: false, code: 'NOT_FOUND', message: notFoundMessage }
    case 'conflict':
      return { ok: false, code: 'CONFLICT', message: TRACK_CONFLICT_MESSAGE }
    case 'cancelled_final':
      return { ok: false, code: 'VALIDATION', message: ORDER_CANCELLED_FINAL_MESSAGE }
    case 'validation':
      return { ok: false, code: 'VALIDATION', message: failure.message }
    default:
      return internalFailure()
  }
}

function failed(response: OrderRpcResponse): boolean {
  return response.error !== null && response.error !== undefined
}

export async function saveOrderShipment(
  orderNumber: string,
  expectedUpdatedAt: string | null,
  form: ShipmentForm,
): Promise<MutationResult<TrackWriteOutcome>> {
  if (!isOrderNumber(orderNumber)) return invalid(ORDER_NUMBER_MESSAGE)
  if (expectedUpdatedAt !== null && !isStamp(expectedUpdatedAt)) return invalid(STAMP_MESSAGE)
  const payload = shipmentPayload(form, null)
  if (!payload.ok) return invalid(payload.message)

  const response = await callOrderRpc('saveShipment', {
    p_order_number: orderNumber,
    p_expected_updated_at: expectedUpdatedAt,
    p_carrier: payload.value.carrier,
    p_tracking_number: payload.value.trackingNumber,
    p_tracking_url: payload.value.trackingUrl,
    p_shipped_on: payload.value.shippedOn,
    p_expected_on: payload.value.expectedOn,
  })
  if (response === null) return internalFailure()
  if (failed(response)) return failureFrom(shipmentFailureKind(response.error, response.status), ORDER_NOT_FOUND_MESSAGE)
  const saved = parseShipmentSaved(response.data)
  if (saved === null || saved.view.orderNumber !== orderNumber || saved.view.shipment === null) return internalFailure()
  return { ok: true, data: { changed: saved.changed, version: saved.view.shipment.updatedAt } }
}

async function writeUpdate(fn: OrderFunction, orderNumber: string, args: Record<string, unknown>): Promise<MutationResult<TrackWriteOutcome>> {
  const response = await callOrderRpc(fn, { p_order_number: orderNumber, ...args })
  if (response === null) return internalFailure()
  if (failed(response)) return failureFrom(updateFailureKind(response.error, response.status), UPDATE_NOT_FOUND_MESSAGE)
  const written = parseUpdatesWritten(response.data)
  if (written === null || written.view.orderNumber !== orderNumber) return internalFailure()
  const row = written.view.updates.find((u) => u.id === written.id)
  if (row === undefined) return internalFailure()
  return { ok: true, data: { changed: written.changed, version: row.updatedAt } }
}

/** الإضافة: النسخة = last_id من آخر قراية (null من غير رسايل). */
export async function addCustomerUpdate(orderNumber: string, expectedLastId: number | null, text: string): Promise<MutationResult<TrackWriteOutcome>> {
  if (!isOrderNumber(orderNumber)) return invalid(ORDER_NUMBER_MESSAGE)
  if (expectedLastId !== null && !isUpdateId(expectedLastId)) return invalid(LAST_ID_MESSAGE)
  const checked = updateText(text)
  if (!checked.ok) return invalid(checked.message)
  return writeUpdate('addCustomerUpdate', orderNumber, { p_expected_last_id: expectedLastId, p_text: checked.value })
}

export async function editCustomerUpdate(
  orderNumber: string,
  updateId: number,
  expectedUpdatedAt: string,
  text: string,
): Promise<MutationResult<TrackWriteOutcome>> {
  if (!isOrderNumber(orderNumber)) return invalid(ORDER_NUMBER_MESSAGE)
  if (!isUpdateId(updateId)) return invalid(UPDATE_ID_MESSAGE)
  if (!isStamp(expectedUpdatedAt)) return invalid(STAMP_MESSAGE)
  const checked = updateText(text)
  if (!checked.ok) return invalid(checked.message)
  return writeUpdate('editCustomerUpdate', orderNumber, {
    p_update_id: updateId,
    p_expected_updated_at: expectedUpdatedAt,
    p_text: checked.value,
  })
}

export async function setCustomerUpdateHidden(
  orderNumber: string,
  updateId: number,
  expectedUpdatedAt: string,
  hidden: boolean,
): Promise<MutationResult<TrackWriteOutcome>> {
  if (!isOrderNumber(orderNumber)) return invalid(ORDER_NUMBER_MESSAGE)
  if (!isUpdateId(updateId)) return invalid(UPDATE_ID_MESSAGE)
  if (!isStamp(expectedUpdatedAt)) return invalid(STAMP_MESSAGE)
  if (typeof hidden !== 'boolean') return invalid(UPDATE_FIELD_MESSAGES.hidden)
  return writeUpdate('setCustomerUpdateHidden', orderNumber, { p_update_id: updateId, p_expected_updated_at: expectedUpdatedAt, p_hidden: hidden })
}
