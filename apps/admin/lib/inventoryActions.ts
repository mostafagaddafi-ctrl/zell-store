'use server'

/**
 * المخزون (0020-UI · PR-A) — Server Actions للمالك بس.
 *
 * الترتيب في كل دالة كتابة (غلاف actionWithAccess — 0021-P ب2):
 *   ١. الهوية                -> UNAUTHENTICATED | FORBIDDEN
 *   ٢. الصلاحية 'zell.inventory0020.edit' (فئة owner) -> FORBIDDEN برسالة INVENTORY_OWNER_ONLY_MESSAGE
 *      للـadmin (حتى لو نادى الـaction مباشرة من غير الواجهة)
 *   ٣. علم التعديلات (mutates: true) -> DISABLED
 *   ٤. التحقق ثم النداء (lib/mutations/inventory) بـ p_actor = ctx.identity.userId
 *   والفشل بيتحوّل لشكل InventoryFailure بـ rejectedFailure (mapFailure) زي النهارده.
 * المعاينة 'zell.inventory0020.view' و mutates: false: مابتكتبش، ولازم تشتغل والتعديلات موقوفة.
 *
 * 🔒 p_actor عمره ما بييجي من الفورم.
 * 🔒 p_command_id بييجي من «نية الكتابة» في الواجهة (lib/inventory/intent.ts) والسيرفر بيتأكد إنه UUID.
 * أي فشل قبل النداء resolution = rejected (العملية أكيد ماتنفذتش).
 */

import { actionWithAccess } from './access/instance'
import type { AccessContext } from './access/wrappers'
import {
  INVENTORY_OWNER_ONLY_MESSAGE,
  rejectedFailure,
  type InventoryResult,
} from './inventory/errors'
import type { OpeningDocPayload } from './inventory/openingForm'
import type { OpeningPreview, OpeningWriteResult } from './inventory/openings'
import type { PurchaseDocPayload } from './inventory/purchaseForm'
import type { PurchasePreview, PurchaseWriteResult } from './inventory/purchases'
import type { SupplierInput, SupplierUpdateInput, SupplierWriteResult } from './inventory/suppliers'
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

export const createSupplierAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    input: SupplierInput,
  ): Promise<InventoryResult<SupplierWriteResult>> =>
    createSupplier(ctx.identity.userId, commandId, input),
)

export const updateSupplierAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    supplierId: number,
    expectedVersion: number,
    input: SupplierUpdateInput,
  ): Promise<InventoryResult<SupplierWriteResult>> =>
    updateSupplier(ctx.identity.userId, commandId, supplierId, expectedVersion, input),
)

// ── فواتير الشراء (PR-B) ────────────────────────────────────────

export const previewPurchaseAction = actionWithAccess(
  'zell.inventory0020.view',
  { mutates: false, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (ctx: AccessContext, doc: PurchaseDocPayload): Promise<InventoryResult<PurchasePreview>> =>
    previewPurchase(ctx.identity.userId, doc),
)

export const createPurchaseAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    doc: PurchaseDocPayload,
  ): Promise<InventoryResult<PurchaseWriteResult>> =>
    createPurchase(ctx.identity.userId, commandId, doc),
)

export const updatePurchaseAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    docId: number,
    expectedVersion: number,
    doc: PurchaseDocPayload,
  ): Promise<InventoryResult<PurchaseWriteResult>> =>
    updatePurchase(ctx.identity.userId, commandId, docId, expectedVersion, doc),
)

export const postPurchaseAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    docId: number,
    expectedVersion: number,
  ): Promise<InventoryResult<PurchaseWriteResult>> =>
    postPurchase(ctx.identity.userId, commandId, docId, expectedVersion),
)

export const discardPurchaseAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    docId: number,
    expectedVersion: number,
    reason: string,
  ): Promise<InventoryResult<PurchaseWriteResult>> =>
    discardPurchase(ctx.identity.userId, commandId, docId, expectedVersion, reason),
)

export const voidPurchaseAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    docId: number,
    expectedVersion: number,
    reason: string,
  ): Promise<InventoryResult<PurchaseWriteResult>> =>
    voidPurchase(ctx.identity.userId, commandId, docId, expectedVersion, reason),
)

// ── رصيد أول المدة (PR-C) ───────────────────────────────────────

export const previewOpeningAction = actionWithAccess(
  'zell.inventory0020.view',
  { mutates: false, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (ctx: AccessContext, doc: OpeningDocPayload): Promise<InventoryResult<OpeningPreview>> =>
    previewOpening(ctx.identity.userId, doc),
)

export const createOpeningAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    doc: OpeningDocPayload,
  ): Promise<InventoryResult<OpeningWriteResult>> =>
    createOpening(ctx.identity.userId, commandId, doc),
)

export const updateOpeningAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    docId: number,
    expectedVersion: number,
    doc: OpeningDocPayload,
  ): Promise<InventoryResult<OpeningWriteResult>> =>
    updateOpening(ctx.identity.userId, commandId, docId, expectedVersion, doc),
)

export const postOpeningAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    docId: number,
    expectedVersion: number,
  ): Promise<InventoryResult<OpeningWriteResult>> =>
    postOpening(ctx.identity.userId, commandId, docId, expectedVersion),
)

export const discardOpeningAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    docId: number,
    expectedVersion: number,
    reason: string,
  ): Promise<InventoryResult<OpeningWriteResult>> =>
    discardOpening(ctx.identity.userId, commandId, docId, expectedVersion, reason),
)

export const voidOpeningAction = actionWithAccess(
  'zell.inventory0020.edit',
  { mutates: true, forbiddenMessage: INVENTORY_OWNER_ONLY_MESSAGE, mapFailure: rejectedFailure },
  async (
    ctx: AccessContext,
    commandId: string,
    docId: number,
    expectedVersion: number,
    reason: string,
  ): Promise<InventoryResult<OpeningWriteResult>> =>
    voidOpening(ctx.identity.userId, commandId, docId, expectedVersion, reason),
)
