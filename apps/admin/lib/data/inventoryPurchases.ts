import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/inventoryPurchases.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { type InventoryResult } from '../inventory/errors'
import type { InventoryDocStatus } from '../inventory/labels'
import {
  PURCHASES_PAGE_SIZE,
  isLocationsPage,
  isPurchasesPage,
  parsePurchaseDetail,
  type InventoryLocationOption,
  type LocationsPage,
  type PurchaseDetail,
  type PurchasesPage,
} from '../inventory/purchases'
import { callInventory, callInventoryWith } from '../inventory/rpc'
import { isSuppliersPage, type InventorySupplier, type SuppliersPage } from '../inventory/suppliers'

export type OptionList<T> = { items: T[]; complete: boolean }

export async function listPurchases(
  options: { status: InventoryDocStatus | null; supplierId: number | null; beforeId: number | null },
): Promise<InventoryResult<PurchasesPage>> {
  return callInventory(
    'listPurchases',
    {
      p_status: options.status,
      p_supplier_id: options.supplierId,
      p_limit: PURCHASES_PAGE_SIZE,
      p_before_id: options.beforeId,
    },
    isPurchasesPage,
  )
}

export async function getPurchase(docId: number): Promise<InventoryResult<PurchaseDetail>> {
  return callInventoryWith('getPurchase', { p_doc_id: docId }, parsePurchaseDetail)
}

/** حد أمان: 5 صفحات × 100. أكتر من كده = القايمة مش كاملة، والنموذج بيتوقف. */
const OPTION_PAGES = 5

const OPTION_PAGE_SIZE = 100

/** الموردين لاختيار المورد (keyset بالاسم). complete = false لو فيه أكتر من الحد. */
export async function loadSupplierOptions(
  includeInactive: boolean,
): Promise<InventoryResult<OptionList<InventorySupplier>>> {
  const items: InventorySupplier[] = []
  let after: string | null = null
  for (let page = 0; page < OPTION_PAGES; page += 1) {
    const result: InventoryResult<SuppliersPage> = await callInventory(
      'listSuppliers',
      { p_include_inactive: includeInactive, p_limit: OPTION_PAGE_SIZE, p_after_name_key: after },
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
  includeInactive = false,
): Promise<InventoryResult<OptionList<InventoryLocationOption>>> {
  const items: InventoryLocationOption[] = []
  let after: number | null = null
  for (let page = 0; page < OPTION_PAGES; page += 1) {
    const result: InventoryResult<LocationsPage> = await callInventory(
      'listLocations',
      { p_include_inactive: includeInactive, p_limit: OPTION_PAGE_SIZE, p_after_id: after },
      isLocationsPage,
    )
    if (!result.ok) return result
    items.push(...result.data.items)
    if (result.data.nextAfterId === null) return { ok: true, data: { items, complete: true } }
    after = result.data.nextAfterId
  }
  return { ok: true, data: { items, complete: false } }
}
