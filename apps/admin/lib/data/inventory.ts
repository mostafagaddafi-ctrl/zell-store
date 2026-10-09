import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/inventory.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { type InventoryResult } from '../inventory/errors'
import { callInventory } from '../inventory/rpc'
import { SUPPLIERS_PAGE_SIZE, isSuppliersPage, type SuppliersPage } from '../inventory/suppliers'

export async function listSuppliers(
  options: { includeInactive: boolean; after: string | null },
): Promise<InventoryResult<SuppliersPage>> {
  return callInventory(
    'listSuppliers',
    {
      p_include_inactive: options.includeInactive,
      p_limit: SUPPLIERS_PAGE_SIZE,
      p_after_name_key: options.after,
    },
    isSuppliersPage,
  )
}
