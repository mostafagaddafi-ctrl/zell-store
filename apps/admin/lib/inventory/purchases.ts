/**
 * فواتير الشراء — أنواع ردود الـRPC وفحص شكلها، وقراءة باراميترات الصفحات. منطق خالص.
 *
 * أي رد مش بالشكل ده بيتعامل INTERNAL غير محسوم (lib/inventory/rpc.ts) — مش بنعرض بيانات ناقصة.
 * الأشكال منقولة من 0020: zell_inv_list_purchases · get_purchase · preview_purchase ·
 * create/update/post/discard/void_purchase · list_locations.
 */

import type { InventoryDocStatus } from './labels'
import { validatePurchaseDoc, type ChargeKind, type PurchaseDocPayload } from './purchaseForm'

export const PURCHASES_PAGE_SIZE = 25

export type PurchaseHeader = {
  docId: number
  docNo: string
  status: InventoryDocStatus
  supplierId: number | null
  supplierName: string | null
  supplierRef: string | null
  locationId: number
  locationName: string
  docDate: string
  note: string | null
  supplierDiscountPiastres: number
  itemsSubtotalPiastres: number
  extrasTotalPiastres: number
  totalCostPiastres: number
  lineCount: number
  chargeCount: number
  lotCount: number
  postedAt: string | null
  voidedAt: string | null
  voidReason: string | null
  discardedAt: string | null
  discardReason: string | null
  version: number
  updatedAt: string
}

export type PurchasesPage = { items: PurchaseHeader[]; nextBeforeId: number | null }

export type PostedLine = {
  lineId: number
  lineNo: number
  kind: 'roll' | 'batch'
  productId: number
  productName: string
  saleUnit: string
  widthCm: number | null
  rollCount: number | null
  totalLengthCm: number | null
  quantity: number | null
  lineTotalPiastres: number
  zeroCostReason: string | null
  allocatedExtrasPiastres: number
  allocatedDiscountPiastres: number
  landedTotalPiastres: number
}

export type PostedCharge = {
  chargeNo: number
  kind: ChargeKind
  amountPiastres: number
  reference: string | null
  note: string | null
}

export type PostedLot = {
  lotId: number
  lotCode: string
  lotKind: 'roll' | 'batch'
  lotSequence: number
  lineNo: number
  productId: number
  widthCm: number | null
  initialLengthCm: number | null
  initialQuantity: number | null
  baseCostPiastres: number
  allocatedExtrasPiastres: number
  allocatedDiscountPiastres: number
  landedCostPiastres: number
  receivedOn: string
  status: 'active' | 'voided'
}

export type PurchaseDetail = {
  header: PurchaseHeader
  draftPayload: PurchaseDocPayload | null
  lines: PostedLine[]
  charges: PostedCharge[]
  lots: PostedLot[]
}

export type PreviewLot = {
  lineNo: number
  lotSequence: number
  baseCostPiastres: number
  allocatedExtrasPiastres: number
  allocatedDiscountPiastres: number
  landedCostPiastres: number
}

export type PurchaseTotals = {
  itemsSubtotalPiastres: number
  extrasTotalPiastres: number
  supplierDiscountPiastres: number
  totalCostPiastres: number
}

export type PurchasePreview = { totals: PurchaseTotals; lots: PreviewLot[] }

export type PurchaseWriteResult = {
  docId: number
  docNo: string
  status: InventoryDocStatus
  version: number
  replayed?: boolean
}

export type InventoryLocationOption = {
  locationId: number
  code: string
  name: string
  isDefault: boolean
  isActive: boolean
}

export type LocationsPage = { items: InventoryLocationOption[]; nextAfterId: number | null }

// ── أدوات الفحص ───────────────────────────────────────────────────

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

function str(value: unknown): value is string {
  return typeof value === 'string'
}

function nstr(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

const DOC_STATUSES: readonly string[] = ['draft', 'posted', 'discarded', 'voided']

function isDocStatus(value: unknown): value is InventoryDocStatus {
  return typeof value === 'string' && DOC_STATUSES.includes(value)
}

function isKind(value: unknown): value is 'roll' | 'batch' {
  return value === 'roll' || value === 'batch'
}

const CHARGE_KIND_SET: readonly string[] = ['transport', 'loading', 'customs', 'other']

export function isPurchaseHeader(value: unknown): value is PurchaseHeader {
  if (!isRec(value)) return false
  return (
    int(value['docId'], 1) &&
    str(value['docNo']) &&
    isDocStatus(value['status']) &&
    nint(value['supplierId'], 1) &&
    nstr(value['supplierName']) &&
    nstr(value['supplierRef']) &&
    int(value['locationId'], 1) &&
    str(value['locationName']) &&
    str(value['docDate']) &&
    nstr(value['note']) &&
    int(value['supplierDiscountPiastres']) &&
    int(value['itemsSubtotalPiastres']) &&
    int(value['extrasTotalPiastres']) &&
    typeof value['totalCostPiastres'] === 'number' &&
    Number.isSafeInteger(value['totalCostPiastres']) &&
    int(value['lineCount']) &&
    int(value['chargeCount']) &&
    int(value['lotCount']) &&
    nstr(value['postedAt']) &&
    nstr(value['voidedAt']) &&
    nstr(value['voidReason']) &&
    nstr(value['discardedAt']) &&
    nstr(value['discardReason']) &&
    int(value['version'], 1) &&
    str(value['updatedAt'])
  )
}

export function isPurchasesPage(value: unknown): value is PurchasesPage {
  if (!isRec(value)) return false
  const items = value['items']
  return Array.isArray(items) && items.every(isPurchaseHeader) && nint(value['nextBeforeId'] ?? null, 1)
}

function isPostedLine(value: unknown): value is PostedLine {
  if (!isRec(value)) return false
  return (
    int(value['lineId'], 1) &&
    int(value['lineNo'], 1) &&
    isKind(value['kind']) &&
    int(value['productId'], 1) &&
    str(value['productName']) &&
    str(value['saleUnit']) &&
    nint(value['widthCm'], 1) &&
    nint(value['rollCount'], 0) &&
    nint(value['totalLengthCm'], 0) &&
    nint(value['quantity'], 0) &&
    int(value['lineTotalPiastres']) &&
    nstr(value['zeroCostReason']) &&
    int(value['allocatedExtrasPiastres']) &&
    int(value['allocatedDiscountPiastres']) &&
    int(value['landedTotalPiastres'])
  )
}

function isPostedCharge(value: unknown): value is PostedCharge {
  if (!isRec(value)) return false
  return (
    int(value['chargeNo'], 1) &&
    typeof value['kind'] === 'string' &&
    CHARGE_KIND_SET.includes(value['kind']) &&
    int(value['amountPiastres'], 1) &&
    nstr(value['reference']) &&
    nstr(value['note'])
  )
}

function isPostedLot(value: unknown): value is PostedLot {
  if (!isRec(value)) return false
  return (
    int(value['lotId'], 1) &&
    str(value['lotCode']) &&
    isKind(value['lotKind']) &&
    int(value['lotSequence'], 1) &&
    int(value['lineNo'], 1) &&
    int(value['productId'], 1) &&
    nint(value['widthCm'], 1) &&
    nint(value['initialLengthCm'], 1) &&
    nint(value['initialQuantity'], 1) &&
    int(value['baseCostPiastres']) &&
    int(value['allocatedExtrasPiastres']) &&
    int(value['allocatedDiscountPiastres']) &&
    int(value['landedCostPiastres']) &&
    str(value['receivedOn']) &&
    (value['status'] === 'active' || value['status'] === 'voided')
  )
}

/**
 * تفاصيل الفاتورة. الـdraftPayload بيتفحص بنفس validatePurchaseDoc، وبيترجع منه النسخة المطبّعة.
 * null لو الشكل مش صح.
 */
export function parsePurchaseDetail(value: unknown): PurchaseDetail | null {
  if (!isRec(value)) return null
  const header = value['header']
  if (!isPurchaseHeader(header)) return null
  const lines = value['lines']
  const charges = value['charges']
  const lots = value['lots']
  if (!Array.isArray(lines) || !lines.every(isPostedLine)) return null
  if (!Array.isArray(charges) || !charges.every(isPostedCharge)) return null
  if (!Array.isArray(lots) || !lots.every(isPostedLot)) return null

  const rawPayload = value['draftPayload'] ?? null
  let draftPayload: PurchaseDocPayload | null = null
  if (rawPayload !== null) {
    const parsed = validatePurchaseDoc(rawPayload)
    if (!parsed.ok) return null
    draftPayload = parsed.value
  }
  // المسودة لازم يبقى ليها payload، والمرحّل/المبطل مالوش (بيتمسح بعد الترحيل)
  if (header.status === 'draft' && draftPayload === null) return null
  return { header, draftPayload, lines, charges, lots }
}

export function isPurchaseDetail(value: unknown): value is PurchaseDetail {
  return parsePurchaseDetail(value) !== null
}

function isPreviewLot(value: unknown): value is PreviewLot {
  if (!isRec(value)) return false
  return (
    int(value['lineNo'], 1) &&
    int(value['lotSequence'], 1) &&
    int(value['baseCostPiastres']) &&
    int(value['allocatedExtrasPiastres']) &&
    int(value['allocatedDiscountPiastres']) &&
    int(value['landedCostPiastres'])
  )
}

function isTotals(value: unknown): value is PurchaseTotals {
  if (!isRec(value)) return false
  return (
    int(value['itemsSubtotalPiastres']) &&
    int(value['extrasTotalPiastres']) &&
    int(value['supplierDiscountPiastres']) &&
    typeof value['totalCostPiastres'] === 'number' &&
    Number.isSafeInteger(value['totalCostPiastres'])
  )
}

export function isPurchasePreview(value: unknown): value is PurchasePreview {
  if (!isRec(value)) return false
  const lots = value['lots']
  return isTotals(value['totals']) && Array.isArray(lots) && lots.every(isPreviewLot)
}

export function isPurchaseWriteResult(value: unknown): value is PurchaseWriteResult {
  if (!isRec(value)) return false
  const replayed = value['replayed']
  return (
    int(value['docId'], 1) &&
    str(value['docNo']) &&
    isDocStatus(value['status']) &&
    int(value['version'], 1) &&
    (replayed === undefined || typeof replayed === 'boolean')
  )
}

function isLocationOption(value: unknown): value is InventoryLocationOption {
  if (!isRec(value)) return false
  return (
    int(value['locationId'], 1) &&
    str(value['code']) &&
    str(value['name']) &&
    typeof value['isDefault'] === 'boolean' &&
    typeof value['isActive'] === 'boolean'
  )
}

export function isLocationsPage(value: unknown): value is LocationsPage {
  if (!isRec(value)) return false
  const items = value['items']
  return Array.isArray(items) && items.every(isLocationOption) && nint(value['nextAfterId'] ?? null, 1)
}

// ── باراميترات الصفحات ─────────────────────────────────────────────

export function parseDocStatusParam(raw: unknown): InventoryDocStatus | null {
  return isDocStatus(raw) ? raw : null
}

/** id موجب من نص URL. أي حاجة تانية → null. */
export function parseIdParam(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[0-9]{1,15}$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id >= 1 ? id : null
}
