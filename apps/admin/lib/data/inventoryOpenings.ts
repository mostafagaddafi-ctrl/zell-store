import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/inventoryOpenings.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { type InventoryResult } from '../inventory/errors'
import type { InventoryDocStatus } from '../inventory/labels'
import { LOTS_PAGE_SIZE, isLotsPage, type LotStatusFilter, type LotsPage } from '../inventory/lots'
import {
  OPENINGS_PAGE_SIZE,
  isOpeningsPage,
  parseOpeningDetail,
  type OpeningDetail,
  type OpeningsPage,
} from '../inventory/openings'
import { callInventory, callInventoryWith } from '../inventory/rpc'

export async function listOpenings(
  options: { status: InventoryDocStatus | null; beforeId: number | null; limit?: number },
): Promise<InventoryResult<OpeningsPage>> {
  return callInventory(
    'listOpenings',
    { p_status: options.status, p_limit: options.limit ?? OPENINGS_PAGE_SIZE, p_before_id: options.beforeId },
    isOpeningsPage,
  )
}

export async function getOpening(docId: number): Promise<InventoryResult<OpeningDetail>> {
  return callInventoryWith('getOpening', { p_doc_id: docId }, parseOpeningDetail)
}

export async function listLots(
  options: { status: LotStatusFilter; productId: number | null; locationId: number | null; beforeId: number | null },
): Promise<InventoryResult<LotsPage>> {
  return callInventory(
    'listLots',
    {
      p_status: options.status,
      p_product_id: options.productId,
      p_location_id: options.locationId,
      p_limit: LOTS_PAGE_SIZE,
      p_before_id: options.beforeId,
    },
    isLotsPage,
  )
}
