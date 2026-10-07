/**
 * صفحة الدفعات العامة — أنواع رد zell_inv_list_lots وفحصه الصارم، ودمج الأسماء. منطق خالص.
 *
 * list_lots بترجّع productId و locationId من غير أسماء، وممنوع قراءة جداول 0020 مباشرة. فالأسماء
 * بتتدمج على السيرفر بعدد ثابت من الطلبات (عقد v2 · B2 + ملحق المراجعة · 2):
 *   1. list_lots
 *   2. أسماء المنتجات اللي ظاهرة في الصفحة بس — طلب واحد بفلتر ids (readInventoryProductNames)
 *   3. list_locations (صفحات keyset بحد أمان؛ لو أكبر من الحد → تنبيه، مش بنعتبر أول صفحة كاملة)
 * والاسم الغايب بيظهر «منتج #id» / «مخزن #id».
 */

import { lotShapeOk } from './purchases'

export const LOTS_PAGE_SIZE = 50

export type LotStatusFilter = 'active' | 'voided'

export type InventoryLot = {
  lotId: number
  lotCode: string
  sourceKind: 'purchase' | 'opening'
  lotKind: 'roll' | 'batch'
  lotSequence: number
  productId: number
  locationId: number
  widthCm: number | null
  initialLengthCm: number | null
  initialQuantity: number | null
  baseCostPiastres: number
  allocatedExtrasPiastres: number
  allocatedDiscountPiastres: number
  landedCostPiastres: number
  costIsEstimated: boolean
  receivedOn: string
  status: 'active' | 'voided'
  voidedAt: string | null
}

export type LotsPage = { items: InventoryLot[]; nextBeforeId: number | null }

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function int(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
}

function nint(value: unknown, min = 0): value is number | null {
  return value === null || int(value, min)
}

/**
 * قيود stock_lots: kind_shape · lot_code_shape · landed_eq · opening_no_alloc ·
 * purchase_not_estimated · void_stamps (voided ⇔ voidedAt).
 */
export function isInventoryLot(value: unknown): value is InventoryLot {
  if (!isRec(value)) return false
  const shape =
    int(value['lotId'], 1) &&
    typeof value['lotCode'] === 'string' &&
    (value['sourceKind'] === 'purchase' || value['sourceKind'] === 'opening') &&
    (value['lotKind'] === 'roll' || value['lotKind'] === 'batch') &&
    int(value['lotSequence'], 1) &&
    int(value['productId'], 1) &&
    int(value['locationId'], 1) &&
    nint(value['widthCm'], 1) &&
    nint(value['initialLengthCm'], 1) &&
    nint(value['initialQuantity'], 1) &&
    int(value['baseCostPiastres']) &&
    int(value['allocatedExtrasPiastres']) &&
    int(value['allocatedDiscountPiastres']) &&
    int(value['landedCostPiastres']) &&
    typeof value['costIsEstimated'] === 'boolean' &&
    typeof value['receivedOn'] === 'string' &&
    (value['status'] === 'active' || value['status'] === 'voided') &&
    (value['voidedAt'] === null || typeof value['voidedAt'] === 'string')
  if (!shape) return false
  const lot = value as InventoryLot
  if (!lotShapeOk({ ...lot, lineNo: 1 })) return false
  if (lot.landedCostPiastres !== lot.baseCostPiastres + lot.allocatedExtrasPiastres - lot.allocatedDiscountPiastres) return false
  if (lot.sourceKind === 'opening' && (lot.allocatedExtrasPiastres !== 0 || lot.allocatedDiscountPiastres !== 0)) return false
  if (lot.sourceKind === 'purchase' && lot.costIsEstimated) return false
  if ((lot.status === 'voided') !== (lot.voidedAt !== null)) return false
  return true
}

export function isLotsPage(value: unknown): value is LotsPage {
  if (!isRec(value)) return false
  const items = value['items']
  return Array.isArray(items) && items.every(isInventoryLot) && nint(value['nextBeforeId'] ?? null, 1)
}

/** الحالة من الـURL؛ الافتراضي «فعّالة» (list_lots بتطلب حالة دايمًا). */
export function parseLotStatusParam(raw: unknown): LotStatusFilter {
  return raw === 'voided' ? 'voided' : 'active'
}

/** أرقام المنتجات اللي ظاهرة في الصفحة، من غير تكرار ومترتبة — لطلب الأسماء الواحد. */
export function productIdsOf(lots: readonly InventoryLot[]): number[] {
  return [...new Set(lots.map((lot) => lot.productId))].sort((a, b) => a - b)
}

export function productLabel(names: ReadonlyMap<number, string>, productId: number): string {
  return names.get(productId) ?? 'منتج #' + String(productId)
}

export function locationLabel(names: ReadonlyMap<number, string>, locationId: number): string {
  return names.get(locationId) ?? 'مخزن #' + String(locationId)
}
