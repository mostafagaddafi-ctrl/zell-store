'use server'

/**
 * المخزون (0020-UI · PR-A) — Server Actions للمالك بس.
 *
 * الترتيب في كل دالة كتابة:
 *   ١. requireAdminAction  -> UNAUTHENTICATED | FORBIDDEN
 *   ٢. ownerGate           -> FORBIDDEN للـadmin (حتى لو نادى الـaction مباشرة من غير الواجهة)
 *   ٣. guardMutations      -> DISABLED
 *   ٤. التحقق ثم النداء (lib/mutations/inventory) بـ p_actor = identity.userId
 *
 * 🔒 p_actor عمره ما بييجي من الفورم.
 * 🔒 p_command_id بييجي من «نية الكتابة» في الواجهة (lib/inventory/intent.ts) والسيرفر بيتأكد إنه UUID.
 * أي فشل قبل النداء resolution = rejected (العملية أكيد ماتنفذتش).
 */

import { requireAdminAction } from './auth/guards'
import { ownerGate } from './coupons/form'
import {
  INVENTORY_OWNER_ONLY_MESSAGE,
  rejectedFailure,
  type InventoryFailure,
  type InventoryResult,
} from './inventory/errors'
import type { OpeningDocPayload } from './inventory/openingForm'
import type { OpeningPreview, OpeningWriteResult } from './inventory/openings'
import type { PurchaseDocPayload } from './inventory/purchaseForm'
import type { PurchasePreview, PurchaseWriteResult } from './inventory/purchases'
import type { SupplierInput, SupplierUpdateInput, SupplierWriteResult } from './inventory/suppliers'
import { guardMutations } from './mutations'
import { createSupplier, updateSupplier } from './mutations/inventory'
import {
  createPurchase,
  discardPurchase,
  postPurchase,
  previewPurchase,
  updatePurchase,
  voidPurchase,
} from './mutations/inventoryPurchases'
import {
  createOpening,
  discardOpening,
  postOpening,
  previewOpening,
  updateOpening,
  voidOpening,
} from './mutations/inventoryOpenings'

async function ownerWriter(): Promise<{ ok: true; actor: string } | InventoryFailure> {
  const auth = await requireAdminAction()
  if (!auth.ok) return rejectedFailure(auth)
  if (ownerGate(auth.identity.role) !== null) {
    return rejectedFailure({ code: 'FORBIDDEN', message: INVENTORY_OWNER_ONLY_MESSAGE })
  }
  const disabled = guardMutations()
  if (disabled !== null && !disabled.ok) return rejectedFailure(disabled)
  return { ok: true, actor: auth.identity.userId }
}

/**
 * قراءة تفاعلية (المعاينة): نفس الحراس من غير guardMutations — المعاينة مابتكتبش حاجة،
 * ولازم تفضل شغالة حتى لو التعديلات موقوفة.
 */
async function ownerReader(): Promise<{ ok: true; actor: string } | InventoryFailure> {
  const auth = await requireAdminAction()
  if (!auth.ok) return rejectedFailure(auth)
  if (ownerGate(auth.identity.role) !== null) {
    return rejectedFailure({ code: 'FORBIDDEN', message: INVENTORY_OWNER_ONLY_MESSAGE })
  }
  return { ok: true, actor: auth.identity.userId }
}

export async function createSupplierAction(
  commandId: string,
  input: SupplierInput,
): Promise<InventoryResult<SupplierWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return createSupplier(gate.actor, commandId, input)
}

export async function updateSupplierAction(
  commandId: string,
  supplierId: number,
  expectedVersion: number,
  input: SupplierUpdateInput,
): Promise<InventoryResult<SupplierWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return updateSupplier(gate.actor, commandId, supplierId, expectedVersion, input)
}

// ── فواتير الشراء (PR-B) ────────────────────────────────────────

export async function previewPurchaseAction(doc: PurchaseDocPayload): Promise<InventoryResult<PurchasePreview>> {
  const gate = await ownerReader()
  if (!gate.ok) return gate
  return previewPurchase(gate.actor, doc)
}

export async function createPurchaseAction(
  commandId: string,
  doc: PurchaseDocPayload,
): Promise<InventoryResult<PurchaseWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return createPurchase(gate.actor, commandId, doc)
}

export async function updatePurchaseAction(
  commandId: string,
  docId: number,
  expectedVersion: number,
  doc: PurchaseDocPayload,
): Promise<InventoryResult<PurchaseWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return updatePurchase(gate.actor, commandId, docId, expectedVersion, doc)
}

export async function postPurchaseAction(
  commandId: string,
  docId: number,
  expectedVersion: number,
): Promise<InventoryResult<PurchaseWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return postPurchase(gate.actor, commandId, docId, expectedVersion)
}

export async function discardPurchaseAction(
  commandId: string,
  docId: number,
  expectedVersion: number,
  reason: string,
): Promise<InventoryResult<PurchaseWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return discardPurchase(gate.actor, commandId, docId, expectedVersion, reason)
}

export async function voidPurchaseAction(
  commandId: string,
  docId: number,
  expectedVersion: number,
  reason: string,
): Promise<InventoryResult<PurchaseWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return voidPurchase(gate.actor, commandId, docId, expectedVersion, reason)
}

// ── رصيد أول المدة (PR-C) ───────────────────────────────────────

export async function previewOpeningAction(doc: OpeningDocPayload): Promise<InventoryResult<OpeningPreview>> {
  const gate = await ownerReader()
  if (!gate.ok) return gate
  return previewOpening(gate.actor, doc)
}

export async function createOpeningAction(
  commandId: string,
  doc: OpeningDocPayload,
): Promise<InventoryResult<OpeningWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return createOpening(gate.actor, commandId, doc)
}

export async function updateOpeningAction(
  commandId: string,
  docId: number,
  expectedVersion: number,
  doc: OpeningDocPayload,
): Promise<InventoryResult<OpeningWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return updateOpening(gate.actor, commandId, docId, expectedVersion, doc)
}

export async function postOpeningAction(
  commandId: string,
  docId: number,
  expectedVersion: number,
): Promise<InventoryResult<OpeningWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return postOpening(gate.actor, commandId, docId, expectedVersion)
}

export async function discardOpeningAction(
  commandId: string,
  docId: number,
  expectedVersion: number,
  reason: string,
): Promise<InventoryResult<OpeningWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return discardOpening(gate.actor, commandId, docId, expectedVersion, reason)
}

export async function voidOpeningAction(
  commandId: string,
  docId: number,
  expectedVersion: number,
  reason: string,
): Promise<InventoryResult<OpeningWriteResult>> {
  const gate = await ownerWriter()
  if (!gate.ok) return gate
  return voidOpening(gate.actor, commandId, docId, expectedVersion, reason)
}
