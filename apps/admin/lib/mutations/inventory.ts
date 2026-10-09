import 'server-only'

import { COMMAND_ID_MESSAGE, validationFailure, type InventoryResult } from '../inventory/errors'
import { isUuid, parseDbId, parseVersion } from '../inventory/ids'
import { callInventory } from '../inventory/rpc'
import {
  isSupplierWriteResult,
  normalizeSupplierInput,
  normalizeSupplierUpdate,
  type SupplierWriteResult,
} from '../inventory/suppliers'

/**
 * عمليات الموردين (0020-UI · PR-A) — سيرفر بس.
 *
 * المستدعي مسؤول عن الحراس:
 *   • الكتابة من lib/inventoryActions.ts (requireAdminAction → ownerGate → guardMutations).
 *   • القراءة من الصفحة بعد requireAdminPage وفحص المالك.
 * الممثل = sub من JWT الجلسة جوه الداتابيز (zell_inv_session_* — 0020-S PR-2)، والدالة بتتأكد إنه مالك نشط.
 *
 * التحقق بيتعاد هنا كامل قبل النداء — الواجهة مش خط الدفاع.
 */

export async function createSupplier(
  rawCommandId: unknown,
  rawInput: unknown,
): Promise<InventoryResult<SupplierWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const input = normalizeSupplierInput(rawInput)
  if (!input.ok) return validationFailure(input.message)

  return callInventory(
    'createSupplier',
    {
      p_command_id: rawCommandId,
      p_name: input.value.name,
      p_phone: input.value.phone,
      p_note: input.value.note,
    },
    isSupplierWriteResult,
  )
}

export async function updateSupplier(
  rawCommandId: unknown,
  rawSupplierId: unknown,
  rawExpectedVersion: unknown,
  rawInput: unknown,
): Promise<InventoryResult<SupplierWriteResult>> {
  if (!isUuid(rawCommandId)) return validationFailure(COMMAND_ID_MESSAGE)
  const supplierId = parseDbId(rawSupplierId)
  if (supplierId === null) return validationFailure('معرّف المورد غير صالح.')
  const expectedVersion = parseVersion(rawExpectedVersion)
  if (expectedVersion === null) return validationFailure('رقم نسخة المورد غير صالح. حدّث الصفحة.')
  const input = normalizeSupplierUpdate(rawInput)
  if (!input.ok) return validationFailure(input.message)

  return callInventory(
    'updateSupplier',
    {
      p_command_id: rawCommandId,
      p_supplier_id: supplierId,
      p_expected_version: expectedVersion,
      p_name: input.value.name,
      p_phone: input.value.phone,
      p_note: input.value.note,
      p_is_active: input.value.isActive,
    },
    isSupplierWriteResult,
  )
}
