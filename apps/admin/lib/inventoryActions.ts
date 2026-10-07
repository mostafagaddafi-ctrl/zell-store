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
import type { SupplierInput, SupplierUpdateInput, SupplierWriteResult } from './inventory/suppliers'
import { guardMutations } from './mutations'
import { createSupplier, updateSupplier } from './mutations/inventory'

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
