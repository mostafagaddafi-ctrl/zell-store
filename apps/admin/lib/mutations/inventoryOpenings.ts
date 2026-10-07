import 'server-only'

import { COMMAND_ID_MESSAGE, validationFailure, type InventoryResult } from '../inventory/errors'
import { isUuid, parseDbId, parseVersion } from '../inventory/ids'
import type { InventoryDocStatus } from '../inventory/labels'
import { LOTS_PAGE_SIZE, isLotsPage, type LotStatusFilter, type LotsPage } from '../inventory/lots'
import { validateOpeningDoc } from '../inventory/openingForm'
import {
  OPENINGS_PAGE_SIZE,
  isOpeningPreview,
  isOpeningWriteResult,
  isOpeningsPage,
  parseOpeningDetail,
  type OpeningDetail,
  type OpeningPreview,
  type OpeningWriteResult,
  type OpeningsPage,
} from '../inventory/openings'
import { normalizeReason } from '../inventory/purchaseForm'
import { callInventory, callInventoryWith } from '../inventory/rpc'

/**
 * رصيد أول المدة وصفحة الدفعات (0020-UI · PR-C) — سيرفر بس.
 *
 * نفس قواعد الشراء: المستدعي مسؤول عن الحراس (lib/inventoryActions.ts للكتابة والمعاينة، والصفحات
 * للقراءة)، و actor دايمًا identity.userId من الجلسة. أي doc جاي من الواجهة بيعدّي على
 * validateOpeningDoc (نفس zell_inv_normalize_opening بالحرف) قبل النداء.
 */

const BAD_DOC_ID = 'رقم المستند غير صالح.'
const BAD_VERSION = 'رقم نسخة المستند غير صالح. حدّث الصفحة.'

// ── القراءة ────────────────────────────────────────────────────────

export async function listOpenings(
  actor: string,
  options: { status: InventoryDocStatus | null; beforeId: number | null },
): Promise<InventoryResult<OpeningsPage>> {
  return callInventory(
    'listOpenings',
    { p_actor: actor, p_status: options.status, p_limit: OPENINGS_PAGE_SIZE, p_before_id: options.beforeId },
    isOpeningsPage,
  )
}

export async function getOpening(actor: string, docId: number): Promise<InventoryResult<OpeningDetail>> {
  return callInventoryWith('getOpening', { p_actor: actor, p_doc_id: docId }, parseOpeningDetail)
}

export async function previewOpening(actor: string, rawDoc: unknown): Promise<InventoryResult<OpeningPreview>> {
  const doc = validateOpeningDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory('previewOpening', { p_actor: actor, p_doc: doc.value }, isOpeningPreview)
}

export async function listLots(
  actor: string,
  options: { status: LotStatusFilter; productId: number | null; locationId: number | null; beforeId: number | null },
): Promise<InventoryResult<LotsPage>> {
  return callInventory(
    'listLots',
    {
      p_actor: actor,
      p_status: options.status,
      p_product_id: options.productId,
      p_location_id: options.locationId,
      p_limit: LOTS_PAGE_SIZE,
      p_before_id: options.beforeId,
    },
    isLotsPage,
  )
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
  actor: string,
  rawCommandId: unknown,
  rawDoc: unknown,
): Promise<InventoryResult<OpeningWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const doc = validateOpeningDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory('createOpening', { p_actor: actor, p_command_id: rawCommandId, p_doc: doc.value }, isOpeningWriteResult)
}

export async function updateOpening(
  actor: string,
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
    { p_actor: actor, p_command_id: rawCommandId, p_doc_id: ref.docId, p_expected_version: ref.expectedVersion, p_doc: doc.value },
    isOpeningWriteResult,
  )
}

export async function postOpening(
  actor: string,
  rawCommandId: unknown,
  rawDocId: unknown,
  rawExpectedVersion: unknown,
): Promise<InventoryResult<OpeningWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const ref = docRef(rawDocId, rawExpectedVersion)
  if (typeof ref === 'string') return validationFailure(ref)
  return callInventory(
    'postOpening',
    { p_actor: actor, p_command_id: rawCommandId, p_doc_id: ref.docId, p_expected_version: ref.expectedVersion },
    isOpeningWriteResult,
  )
}

/** الاستبعاد: السبب إجباري هنا (1–300)، أشد من الداتابيز. */
export async function discardOpening(
  actor: string,
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
    { p_actor: actor, p_command_id: rawCommandId, p_doc_id: ref.docId, p_expected_version: ref.expectedVersion, p_reason: reason.value },
    isOpeningWriteResult,
  )
}

/** الإبطال: السبب 3–300 زي الداتابيز. */
export async function voidOpening(
  actor: string,
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
    { p_actor: actor, p_command_id: rawCommandId, p_doc_id: ref.docId, p_expected_version: ref.expectedVersion, p_reason: reason.value },
    isOpeningWriteResult,
  )
}
