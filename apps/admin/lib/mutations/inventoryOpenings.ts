import 'server-only'

import { COMMAND_ID_MESSAGE, validationFailure, type InventoryResult } from '../inventory/errors'
import { isUuid, parseDbId, parseVersion } from '../inventory/ids'
import { validateOpeningDoc } from '../inventory/openingForm'
import { isOpeningPreview, type OpeningPreview, type OpeningWriteResult } from '../inventory/openings'
import { normalizeReason } from '../inventory/purchaseForm'
import { callInventory } from '../inventory/rpc'
import { writeResultGuard } from '../inventory/writeResults'

/**
 * رصيد أول المدة وصفحة الدفعات (0020-UI · PR-C) — سيرفر بس.
 *
 * نفس قواعد الشراء: المستدعي مسؤول عن الحراس (lib/inventoryActions.ts للكتابة والمعاينة، والصفحات
 * للقراءة)، والممثل = sub من JWT الجلسة جوه الداتابيز (0020-S PR-2). أي doc جاي من الواجهة بيعدّي على
 * validateOpeningDoc (نفس zell_inv_normalize_opening بالحرف) قبل النداء.
 */

const BAD_DOC_ID = 'رقم المستند غير صالح.'
const BAD_VERSION = 'رقم نسخة المستند غير صالح. حدّث الصفحة.'

// ── القراءة ────────────────────────────────────────────────────────

export async function previewOpening(rawDoc: unknown): Promise<InventoryResult<OpeningPreview>> {
  const doc = validateOpeningDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory('previewOpening', { p_doc: doc.value }, isOpeningPreview)
}

// ── الكتابة ────────────────────────────────────────────────────────

function docRef(rawDocId: unknown, rawExpectedVersion: unknown): { docId: number; expectedVersion: number } | string {
  const docId = parseDbId(rawDocId)
  if (docId === null) return BAD_DOC_ID
  const expectedVersion = parseVersion(rawExpectedVersion)
  if (expectedVersion === null) return BAD_VERSION
  return { docId, expectedVersion }
}

export async function createOpening(
  rawCommandId: unknown,
  rawDoc: unknown,
): Promise<InventoryResult<OpeningWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const doc = validateOpeningDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory('createOpening', { p_command_id: rawCommandId, p_doc: doc.value }, writeResultGuard('opening', 'create'))
}

export async function updateOpening(
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
  rawDoc: unknown,
): Promise<InventoryResult<OpeningWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const ref = docRef(rawDocId, rawExpectedVersion)
  if (typeof ref === 'string') return validationFailure(ref)
  const doc = validateOpeningDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory(
    'updateOpening',
    { p_command_id: rawCommandId, p_doc_id: ref.docId, p_expected_version: ref.expectedVersion, p_doc: doc.value },
    writeResultGuard('opening', 'update'),
  )
}

export async function postOpening(
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
): Promise<InventoryResult<OpeningWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const ref = docRef(rawDocId, rawExpectedVersion)
  if (typeof ref === 'string') return validationFailure(ref)
  return callInventory(
    'postOpening',
    { p_command_id: rawCommandId, p_doc_id: ref.docId, p_expected_version: ref.expectedVersion },
    writeResultGuard('opening', 'post'),
  )
}

/** الاستبعاد: السبب إجباري هنا (1–300)، أشد من الداتابيز. */
export async function discardOpening(
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
  rawReason: unknown,
): Promise<InventoryResult<OpeningWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const ref = docRef(rawDocId, rawExpectedVersion)
  if (typeof ref === 'string') return validationFailure(ref)
  const reason = normalizeReason(rawReason, 'discard')
  if (!reason.ok) return validationFailure(reason.message)
  return callInventory(
    'discardOpening',
    { p_command_id: rawCommandId, p_doc_id: ref.docId, p_expected_version: ref.expectedVersion, p_reason: reason.value },
    writeResultGuard('opening', 'discard'),
  )
}

/** الإبطال: السبب 3–300 زي الداتابيز. */
export async function voidOpening(
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
  rawReason: unknown,
): Promise<InventoryResult<OpeningWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const ref = docRef(rawDocId, rawExpectedVersion)
  if (typeof ref === 'string') return validationFailure(ref)
  const reason = normalizeReason(rawReason, 'void')
  if (!reason.ok) return validationFailure(reason.message)
  return callInventory(
    'voidOpening',
    { p_command_id: rawCommandId, p_doc_id: ref.docId, p_expected_version: ref.expectedVersion, p_reason: reason.value },
    writeResultGuard('opening', 'void'),
  )
}
