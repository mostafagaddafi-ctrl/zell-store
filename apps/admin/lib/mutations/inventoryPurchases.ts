import 'server-only'

import { COMMAND_ID_MESSAGE, validationFailure, type InventoryResult } from '../inventory/errors'
import { isUuid, parseDbId, parseVersion } from '../inventory/ids'
import type { InventoryDocStatus } from '../inventory/labels'
import { normalizeReason, validatePurchaseDoc } from '../inventory/purchaseForm'
import {
  PURCHASES_PAGE_SIZE,
  isLocationsPage,
  isPurchasePreview,
  isPurchasesPage,
  parsePurchaseDetail,
  type InventoryLocationOption,
  type LocationsPage,
  type PurchaseDetail,
  type PurchasePreview,
  type PurchaseWriteResult,
  type PurchasesPage,
} from '../inventory/purchases'
import { callInventory, callInventoryWith } from '../inventory/rpc'
import { writeResultGuard } from '../inventory/writeResults'
import { isSuppliersPage, type InventorySupplier, type SuppliersPage } from '../inventory/suppliers'

/**
 * فواتير الشراء (0020-UI · PR-B) — سيرفر بس.
 *
 * المستدعي مسؤول عن الحراس:
 *   • الكتابة من lib/inventoryActions.ts (requireAdminAction → ownerGate → guardMutations).
 *   • القراءة من الصفحات بعد requireAdminPage وفحص المالك، أو من previewPurchaseAction.
 * actor هنا دايمًا identity.userId من الجلسة (عمره ما بييجي من الفورم)، والدوال في الداتابيز
 * بتتأكد إنه مالك نشط.
 *
 * أي doc جاي من الواجهة بيعدّي على validatePurchaseDoc (نفس قواعد الداتابيز بالحرف) قبل النداء.
 */

const BAD_DOC_ID = 'رقم الفاتورة غير صالح.'
const BAD_VERSION = 'رقم نسخة الفاتورة غير صالح. حدّث الصفحة.'

// ── القراءة ────────────────────────────────────────────────────────

export async function listPurchases(
  actor: string,
  options: { status: InventoryDocStatus | null; supplierId: number | null; beforeId: number | null },
): Promise<InventoryResult<PurchasesPage>> {
  return callInventory(
    'listPurchases',
    {
      p_actor: actor,
      p_status: options.status,
      p_supplier_id: options.supplierId,
      p_limit: PURCHASES_PAGE_SIZE,
      p_before_id: options.beforeId,
    },
    isPurchasesPage,
  )
}

export async function getPurchase(actor: string, docId: number): Promise<InventoryResult<PurchaseDetail>> {
  return callInventoryWith('getPurchase', { p_actor: actor, p_doc_id: docId }, parsePurchaseDetail)
}

export async function previewPurchase(actor: string, rawDoc: unknown): Promise<InventoryResult<PurchasePreview>> {
  const doc = validatePurchaseDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory('previewPurchase', { p_actor: actor, p_doc: doc.value }, isPurchasePreview)
}

/** حد أمان: 5 صفحات × 100. أكتر من كده = القايمة مش كاملة، والنموذج بيتوقف. */
const OPTION_PAGES = 5
const OPTION_PAGE_SIZE = 100

export type OptionList<T> = { items: T[]; complete: boolean }

/** الموردين لاختيار المورد (keyset بالاسم). complete = false لو فيه أكتر من الحد. */
export async function loadSupplierOptions(
  actor: string,
  includeInactive: boolean,
): Promise<InventoryResult<OptionList<InventorySupplier>>> {
  const items: InventorySupplier[] = []
  let after: string | null = null
  for (let page = 0; page < OPTION_PAGES; page += 1) {
    const result: InventoryResult<SuppliersPage> = await callInventory(
      'listSuppliers',
      { p_actor: actor, p_include_inactive: includeInactive, p_limit: OPTION_PAGE_SIZE, p_after_name_key: after },
      isSuppliersPage,
    )
    if (!result.ok) return result
    items.push(...result.data.items)
    if (result.data.nextAfterNameKey === null) return { ok: true, data: { items, complete: true } }
    after = result.data.nextAfterNameKey
  }
  return { ok: true, data: { items, complete: false } }
}

/** المخازن لاختيار المخزن (النشطة بس، افتراضيًا) أو لأسماء صفحة الدفعات (includeInactive). keyset بالـid. */
export async function loadLocationOptions(
  actor: string,
  includeInactive = false,
): Promise<InventoryResult<OptionList<InventoryLocationOption>>> {
  const items: InventoryLocationOption[] = []
  let after: number | null = null
  for (let page = 0; page < OPTION_PAGES; page += 1) {
    const result: InventoryResult<LocationsPage> = await callInventory(
      'listLocations',
      { p_actor: actor, p_include_inactive: includeInactive, p_limit: OPTION_PAGE_SIZE, p_after_id: after },
      isLocationsPage,
    )
    if (!result.ok) return result
    items.push(...result.data.items)
    if (result.data.nextAfterId === null) return { ok: true, data: { items, complete: true } }
    after = result.data.nextAfterId
  }
  return { ok: true, data: { items, complete: false } }
}

// ── الكتابة ────────────────────────────────────────────────────────

export async function createPurchase(
  actor: string,
  rawCommandId: unknown,
  rawDoc: unknown,
): Promise<InventoryResult<PurchaseWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const doc = validatePurchaseDoc(rawDoc)
  if (!doc.ok) return validationFailure(doc.message)
  return callInventory(
    'createPurchase',
    { p_actor: actor, p_command_id: rawCommandId, p_doc: doc.value },
    writeResultGuard('purchase', 'create'),
  )
}

export async function updatePurchase(
  actor: string,
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
    { p_actor: actor, p_command_id: rawCommandId, p_doc_id: docId, p_expected_version: expectedVersion, p_doc: doc.value },
    writeResultGuard('purchase', 'update'),
  )
}

export async function postPurchase(
  actor: string,
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
    { p_actor: actor, p_command_id: rawCommandId, p_doc_id: docId, p_expected_version: expectedVersion },
    writeResultGuard('purchase', 'post'),
  )
}

/** الاستبعاد: السبب إجباري هنا (1–300)، أشد من الداتابيز اللي بتسمح بيه فاضي. */
export async function discardPurchase(
  actor: string,
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
    { p_actor: actor, p_command_id: rawCommandId, p_doc_id: docId, p_expected_version: expectedVersion, p_reason: reason.value },
    writeResultGuard('purchase', 'discard'),
  )
}

/** الإبطال: السبب 3–300 زي الداتابيز. */
export async function voidPurchase(
  actor: string,
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
    { p_actor: actor, p_command_id: rawCommandId, p_doc_id: docId, p_expected_version: expectedVersion, p_reason: reason.value },
    writeResultGuard('purchase', 'void'),
  )
}
