/**
 * رصيد أول المدة — أنواع ردود الـRPC وفحص شكلها الصارم بالحرف من قيود 0020. منطق خالص.
 * (zell_inv_list_openings · get_opening · preview_opening · create/update/post/discard/void_opening)
 *
 * أي رد مش بالشكل ده → null → INTERNAL غير محسوم (مش بنعرض بيانات ملتبسة).
 */

import type { InventoryDocStatus } from './labels'
import { validateOpeningDoc, type OpeningDocPayload } from './openingForm'
import { isPreviewLot, isPurchaseWriteResult, linesAndLotsConsistent, type PreviewLot, type PurchaseWriteResult } from './purchases'

export const OPENINGS_PAGE_SIZE = 25

export type OpeningHeader = {
  docId: number
  docNo: string
  status: InventoryDocStatus
  locationId: number
  locationName: string
  asOfDate: string
  note: string | null
  itemsTotalPiastres: number
  estimatedTotalPiastres: number
  lineCount: number
  lotCount: number
  postedAt: string | null
  voidedAt: string | null
  voidReason: string | null
  discardedAt: string | null
  discardReason: string | null
  version: number
  updatedAt: string
}

export type OpeningsPage = { items: OpeningHeader[]; nextBeforeId: number | null }

export type OpeningLine = {
  lineId: number
  lineNo: number
  kind: 'roll' | 'batch'
  productId: number
  productName: string
  saleUnit: 'meter' | 'piece'
  widthCm: number | null
  rollCount: number | null
  totalLengthCm: number | null
  quantity: number | null
  lineTotalPiastres: number
  zeroCostReason: string | null
  costIsEstimated: boolean
  estimateNote: string | null
}

export type OpeningLot = {
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
  landedCostPiastres: number
  costIsEstimated: boolean
  receivedOn: string
  status: 'active' | 'voided'
}

export type OpeningDetail = {
  header: OpeningHeader
  draftPayload: OpeningDocPayload | null
  lines: OpeningLine[]
  lots: OpeningLot[]
}

export type OpeningPreview = {
  totals: { itemsTotalPiastres: number; estimatedTotalPiastres: number }
  lots: PreviewLot[]
}

export type OpeningWriteResult = PurchaseWriteResult

// ── أدوات ─────────────────────────────────────────────────────────

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
const DOC_NO = /^OPN-[0-9]{6,}$/

// ── الهيدر ─────────────────────────────────────────────────────────

function headerShapeOk(value: Rec): boolean {
  return (
    int(value['docId'], 1) &&
    str(value['docNo']) &&
    DOC_NO.test(value['docNo']) &&
    typeof value['status'] === 'string' &&
    DOC_STATUSES.includes(value['status']) &&
    int(value['locationId'], 1) &&
    str(value['locationName']) &&
    str(value['asOfDate']) &&
    nstr(value['note']) &&
    int(value['itemsTotalPiastres']) &&
    int(value['estimatedTotalPiastres']) &&
    int(value['lineCount']) &&
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

/** قيود opening_stock_docs: amount_ranges · status_stamps · draft_lots · posted_shape. */
function headerRulesOk(h: OpeningHeader): boolean {
  if (h.estimatedTotalPiastres > h.itemsTotalPiastres) return false
  const noVoid = h.voidedAt === null && h.voidReason === null
  const noDiscard = h.discardedAt === null && h.discardReason === null
  switch (h.status) {
    case 'draft':
      return h.postedAt === null && noVoid && noDiscard && h.lotCount === 0
    case 'discarded':
      return h.postedAt === null && noVoid && h.discardedAt !== null && h.lotCount === 0
    case 'posted':
      return h.postedAt !== null && noVoid && noDiscard && h.lineCount >= 1 && h.lotCount >= 1
    case 'voided':
      return h.postedAt !== null && h.voidedAt !== null && h.voidReason !== null && noDiscard && h.lineCount >= 1 && h.lotCount >= 1
  }
}

export function isOpeningHeader(value: unknown): value is OpeningHeader {
  return isRec(value) && headerShapeOk(value) && headerRulesOk(value as OpeningHeader)
}

export function isOpeningsPage(value: unknown): value is OpeningsPage {
  if (!isRec(value)) return false
  const items = value['items']
  return Array.isArray(items) && items.every(isOpeningHeader) && nint(value['nextBeforeId'] ?? null, 1)
}

// ── البنود والدفعات ────────────────────────────────────────────────

/** opening_stock_lines: estimate_note (التقدير ⇔ ملاحظة) · zero (صفر ⇒ سبب ومش تقديري، وموجب ⇒ مفيش سبب). */
function isOpeningLine(value: unknown): value is OpeningLine {
  if (!isRec(value)) return false
  const shape =
    int(value['lineId'], 1) &&
    int(value['lineNo'], 1) &&
    (value['kind'] === 'roll' || value['kind'] === 'batch') &&
    int(value['productId'], 1) &&
    str(value['productName']) &&
    (value['saleUnit'] === 'meter' || value['saleUnit'] === 'piece') &&
    nint(value['widthCm'], 1) &&
    nint(value['rollCount'], 0) &&
    nint(value['totalLengthCm'], 0) &&
    nint(value['quantity'], 0) &&
    int(value['lineTotalPiastres']) &&
    nstr(value['zeroCostReason']) &&
    typeof value['costIsEstimated'] === 'boolean' &&
    nstr(value['estimateNote'])
  if (!shape) return false
  const line = value as OpeningLine
  if (line.costIsEstimated !== (line.estimateNote !== null)) return false
  if (line.lineTotalPiastres === 0) return line.zeroCostReason !== null && !line.costIsEstimated
  return line.zeroCostReason === null
}

/** stock_lots لرصيد أول المدة: source_kind = opening، ومفيش توزيع (opening_no_alloc)، والنهائي = الأساسي. */
function isOpeningLot(value: unknown): value is OpeningLot {
  if (!isRec(value)) return false
  return (
    int(value['lotId'], 1) &&
    str(value['lotCode']) &&
    value['sourceKind'] === 'opening' &&
    (value['lotKind'] === 'roll' || value['lotKind'] === 'batch') &&
    int(value['lotSequence'], 1) &&
    int(value['lineNo'], 1) &&
    int(value['productId'], 1) &&
    nint(value['widthCm'], 1) &&
    nint(value['initialLengthCm'], 1) &&
    nint(value['initialQuantity'], 1) &&
    int(value['baseCostPiastres']) &&
    value['allocatedExtrasPiastres'] === 0 &&
    value['allocatedDiscountPiastres'] === 0 &&
    int(value['landedCostPiastres']) &&
    value['landedCostPiastres'] === value['baseCostPiastres'] &&
    typeof value['costIsEstimated'] === 'boolean' &&
    str(value['receivedOn']) &&
    (value['status'] === 'active' || value['status'] === 'voided')
  )
}

function sums(lines: readonly { lineTotalPiastres: number; costIsEstimated: boolean }[]): { items: number; estimated: number } {
  let items = 0
  let estimated = 0
  for (const line of lines) {
    items += line.lineTotalPiastres
    if (line.costIsEstimated) estimated += line.lineTotalPiastres
  }
  return { items, estimated }
}

/**
 * تفاصيل رصيد أول المدة — فحص صارم:
 *   • draft / discarded: draftPayload موجود (ومطبّع بـ validateOpeningDoc)، والبنود والدفعات فاضية،
 *     وعدد البنود والإجماليات (الكل والتقديري) = الـpayload.
 *   • posted: draftPayload = null، والأعداد مطابقة، والإجماليات = البنود، ومجموع الدفعات = الإجمالي،
 *     وكل الدفعات active وتحت بنود متطابقة (linesAndLotsConsistent).
 *   • voided: زي posted بس كل الدفعات voided.
 */
export function parseOpeningDetail(value: unknown): OpeningDetail | null {
  if (!isRec(value)) return null
  const header = value['header']
  if (!isOpeningHeader(header)) return null
  const lines = value['lines']
  const lots = value['lots']
  if (!Array.isArray(lines) || !lines.every(isOpeningLine)) return null
  if (!Array.isArray(lots) || !lots.every(isOpeningLot)) return null

  const rawPayload = value['draftPayload'] ?? null

  if (header.status === 'draft' || header.status === 'discarded') {
    if (rawPayload === null) return null
    const parsed = validateOpeningDoc(rawPayload)
    if (!parsed.ok) return null
    if (lines.length > 0 || lots.length > 0) return null
    if (parsed.value.lines.length !== header.lineCount) return null
    const total = sums(parsed.value.lines)
    if (total.items !== header.itemsTotalPiastres || total.estimated !== header.estimatedTotalPiastres) return null
    return { header, draftPayload: parsed.value, lines: [], lots: [] }
  }

  if (rawPayload !== null) return null
  if (lines.length !== header.lineCount || lots.length !== header.lotCount) return null
  const total = sums(lines)
  if (total.items !== header.itemsTotalPiastres || total.estimated !== header.estimatedTotalPiastres) return null
  let landed = 0
  for (const lot of lots) landed += lot.landedCostPiastres
  if (landed !== header.itemsTotalPiastres) return null
  if (!linesAndLotsConsistent(lines, lots, header.status === 'posted' ? 'active' : 'voided')) return null
  return { header, draftPayload: null, lines, lots }
}

export function isOpeningPreview(value: unknown): value is OpeningPreview {
  if (!isRec(value)) return false
  const totals = value['totals']
  const lots = value['lots']
  return (
    isRec(totals) &&
    int(totals['itemsTotalPiastres']) &&
    int(totals['estimatedTotalPiastres']) &&
    Array.isArray(lots) &&
    lots.every(isPreviewLot)
  )
}

export function isOpeningWriteResult(value: unknown): value is OpeningWriteResult {
  return isPurchaseWriteResult(value)
}
