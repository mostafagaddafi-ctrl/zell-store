import 'server-only'

import { COMMAND_ID_MESSAGE, validationFailure, type InventoryResult } from '../inventory/errors'
import { isUuid, parseDbId, parseVersion } from '../inventory/ids'
import { normalizeReason, validatePurchaseDoc } from '../inventory/purchaseForm'
import { isPurchasePreview, type PurchasePreview, type PurchaseWriteResult } from '../inventory/purchases'
import { callInventory } from '../inventory/rpc'
import { writeResultGuard } from '../inventory/writeResults'

/**
 * فواتير الشراء (0020-UI · PR-B) — سيرفر بس.
 *
 * المستدعي مسؤول عن الحراس:
 *   • الكتابة من lib/inventoryActions.ts (requireAdminAction → ownerGate → guardMutations).
 *   • القراءة من الصفحات بعد requireAdminPage وفحص المالك، أو من previewPurchaseAction.
 * الممثل = sub من JWT الجلسة جوه الداتابيز (zell_inv_session_* — 0020-S PR-2)، ومفيش معامل ممثل من الكود
 * ولا من الفورم، والدوال بتتأكد إنه مالك نشط.
 *
 * أي doc جاي من الواجهة بيعدّي على validatePurchaseDoc (نفس قواعد الداتابيز بالحرف) قبل النداء.
 */

const BAD_DOC_ID = 'رقم الفاتورة غير صالح.'
const BAD_VERSION = 'رقم نسخة الفاتورة غير صالح. حدّث الصفحة.'

// ── القراءة ────────────────────────────────────────────────────────

export async function previewPurchase(rawDoc: unknown): Promise<InventoryResult<PurchasePreview>> {
  const doc = validatePurchaseDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory('previewPurchase', { p_doc: doc.value }, isPurchasePreview)
}

// ── الكتابة ────────────────────────────────────────────────────────

export async function createPurchase(
  rawCommandId: unknown,
  rawDoc: unknown,
): Promise<InventoryResult<PurchaseWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const doc = validatePurchaseDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory(
    'createPurchase',
    { p_command_id: rawCommandId, p_doc: doc.value },
    writeResultGuard('purchase', 'create'),
  )
}

export async function updatePurchase(
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
  rawDoc: unknown,
): Promise<InventoryResult<PurchaseWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const docId = parseDbId(rawDocId)
  if (docId === null) return validationFailure(BAD_DOC_ID)
  const expectedVersion = parseVersion(rawExpectedVersion)
  if (expectedVersion === null) return validationFailure(BAD_VERSION)
  const doc = validatePurchaseDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory(
    'updatePurchase',
    { p_command_id: rawCommandId, p_doc_id: docId, p_expected_version: expectedVersion, p_doc: doc.value },
    writeResultGuard('purchase', 'update'),
  )
}

export async function postPurchase(
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
): Promise<InventoryResult<PurchaseWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const docId = parseDbId(rawDocId)
  if (docId === null) return validationFailure(BAD_DOC_ID)
  const expectedVersion = parseVersion(rawExpectedVersion)
  if (expectedVersion === null) return validationFailure(BAD_VERSION)
  return callInventory(
    'postPurchase',
    { p_command_id: rawCommandId, p_doc_id: docId, p_expected_version: expectedVersion },
    writeResultGuard('purchase', 'post'),
  )
}

/** الاستبعاد: السبب إجباري هنا (1–300)، أشد من الداتابيز اللي بتسمح بيه فاضي. */
export async function discardPurchase(
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
  rawReason: unknown,
): Promise<InventoryResult<PurchaseWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const docId = parseDbId(rawDocId)
  if (docId === null) return validationFailure(BAD_DOC_ID)
  const expectedVersion = parseVersion(rawExpectedVersion)
  if (expectedVersion === null) return validationFailure(BAD_VERSION)
  const reason = normalizeReason(rawReason, 'discard')
  if (!reason.ok) return validationFailure(reason.message)
  return callInventory(
    'discardPurchase',
    { p_command_id: rawCommandId, p_doc_id: docId, p_expected_version: expectedVersion, p_reason: reason.value },
    writeResultGuard('purchase', 'discard'),
  )
}

/** الإبطال: السبب 3–300 زي الداتابيز. */
export async function voidPurchase(
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
  rawReason: unknown,
): Promise<InventoryResult<PurchaseWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const docId = parseDbId(rawDocId)
  if (docId === null) return validationFailure(BAD_DOC_ID)
  const expectedVersion = parseVersion(rawExpectedVersion)
  if (expectedVersion === null) return validationFailure(BAD_VERSION)
  const reason = normalizeReason(rawReason, 'void')
  if (!reason.ok) return validationFailure(reason.message)
  return callInventory(
    'voidPurchase',
    { p_command_id: rawCommandId, p_doc_id: docId, p_expected_version: expectedVersion, p_reason: reason.value },
    writeResultGuard('purchase', 'void'),
  )
}
