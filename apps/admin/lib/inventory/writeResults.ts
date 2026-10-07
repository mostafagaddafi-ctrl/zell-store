/**
 * حراس نتائج الكتابة — مخصصة لكل نوع مستند ولكل عملية (ملاحظة المراجعة على PR #97). منطق خالص.
 *
 * الأشكال منقولة بالحرف من v_result في دوال 0020 (والإعادة بنفس المفتاح بترجّع نفس الشكل + replayed):
 *   create / update → status = draft، و totals
 *        شراء:  { itemsSubtotalPiastres, extrasTotalPiastres, supplierDiscountPiastres, totalCostPiastres }
 *        رصيد:  { itemsTotalPiastres, estimatedTotalPiastres }
 *   post    → status = posted، و totals، و lots: [{ lotId, lotCode, lineNo, lotSequence, landedCostPiastres
 *             (+ costIsEstimated في الرصيد) }]، ومجموع تكلفة الدفعات = إجمالي التكلفة
 *   discard → status = discarded، من غير أي حقول زيادة
 *   void    → status = voided، و voidedLots عدد صحيح موجب
 * رقم المستند: الشراء PUR-…، والرصيد OPN-…. أي مفتاح زيادة أو ناقص أو قيمة مش مطابقة → false
 * → INTERNAL غير محسوم (lib/inventory/rpc.ts).
 */

import type { InventoryDocStatus } from './labels'

export type DocKind = 'purchase' | 'opening'
export type WriteOp = 'create' | 'update' | 'post' | 'discard' | 'void'

export type DocWriteResult = {
  docId: number
  docNo: string
  status: InventoryDocStatus
  version: number
  replayed?: boolean
}

type Rec = Record<string, unknown>

const DOC_NO: Readonly<Record<DocKind, RegExp>> = {
  purchase: /^PUR-[0-9]{6,}$/,
  opening: /^OPN-[0-9]{6,}$/,
}

const EXPECTED_STATUS: Readonly<Record<WriteOp, InventoryDocStatus>> = {
  create: 'draft',
  update: 'draft',
  post: 'posted',
  discard: 'discarded',
  void: 'voided',
}

const EXTRA_KEYS: Readonly<Record<WriteOp, readonly string[]>> = {
  create: ['totals'],
  update: ['totals'],
  post: ['totals', 'lots'],
  discard: [],
  void: ['voidedLots'],
}

const BASE_KEYS = ['docId', 'docNo', 'status', 'version', 'replayed']

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function int(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

function exactKeys(value: Rec, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
}

/** إجمالي التكلفة النهائي المتوقع من الـtotals (للمقارنة بمجموع الدفعات في الترحيل). null = شكل غلط. */
function totalsCost(kind: DocKind, totals: unknown): number | null {
  if (!isRec(totals)) return null
  if (kind === 'purchase') {
    if (!exactKeys(totals, ['itemsSubtotalPiastres', 'extrasTotalPiastres', 'supplierDiscountPiastres', 'totalCostPiastres'], [])) return null
    const items = totals['itemsSubtotalPiastres']
    const extras = totals['extrasTotalPiastres']
    const discount = totals['supplierDiscountPiastres']
    const total = totals['totalCostPiastres']
    if (!int(items) || !int(extras) || !int(discount) || !int(total)) return null
    return total === items + extras - discount ? total : null
  }
  if (!exactKeys(totals, ['itemsTotalPiastres', 'estimatedTotalPiastres'], [])) return null
  const items = totals['itemsTotalPiastres']
  const estimated = totals['estimatedTotalPiastres']
  if (!int(items) || !int(estimated) || estimated > items) return null
  return items
}

const LOT_CODE = /^(R|B)-[0-9]{6,}$/

/** دفعات نتيجة الترحيل: الشكل، ومن غير تكرار، ومجموع التكلفة = الإجمالي. */
function postedLotsOk(kind: DocKind, lots: unknown, expectedTotal: number): boolean {
  if (!Array.isArray(lots) || lots.length < 1 || lots.length > 200) return false
  const ids = new Set<number>()
  const codes = new Set<string>()
  let sum = 0
  for (const lot of lots) {
    if (!isRec(lot)) return false
    const keys = ['lotId', 'lotCode', 'lineNo', 'lotSequence', 'landedCostPiastres']
    if (kind === 'opening') keys.push('costIsEstimated')
    if (!exactKeys(lot, keys, [])) return false
    const lotId = lot['lotId']
    const lotCode = lot['lotCode']
    const landed = lot['landedCostPiastres']
    if (!int(lotId, 1) || typeof lotCode !== 'string' || !LOT_CODE.test(lotCode)) return false
    if (!int(lot['lineNo'], 1, 100) || !int(lot['lotSequence'], 1, 200) || !int(landed)) return false
    if (kind === 'opening' && typeof lot['costIsEstimated'] !== 'boolean') return false
    if (ids.has(lotId) || codes.has(lotCode)) return false
    ids.add(lotId)
    codes.add(lotCode)
    sum += landed
  }
  return sum === expectedTotal
}

export function isDocWriteResult(kind: DocKind, op: WriteOp, value: unknown): value is DocWriteResult {
  if (!isRec(value)) return false
  const extra = EXTRA_KEYS[op]
  if (!exactKeys(value, ['docId', 'docNo', 'status', 'version', ...extra], ['replayed'].concat(BASE_KEYS.filter(() => false)))) return false
  const docNo = value['docNo']
  if (!int(value['docId'], 1) || typeof docNo !== 'string' || !DOC_NO[kind].test(docNo)) return false
  if (value['status'] !== EXPECTED_STATUS[op] || !int(value['version'], 1, 2147483647)) return false
  const replayed = value['replayed']
  if (replayed !== undefined && typeof replayed !== 'boolean') return false

  if (op === 'create' || op === 'update') return totalsCost(kind, value['totals']) !== null
  if (op === 'post') {
    const total = totalsCost(kind, value['totals'])
    return total !== null && postedLotsOk(kind, value['lots'], total)
  }
  if (op === 'void') return int(value['voidedLots'], 1, 200)
  return true
}

/** guard جاهز لنداء واحد (callInventory بياخد predicate). */
export function writeResultGuard(kind: DocKind, op: WriteOp): (value: unknown) => value is DocWriteResult {
  return (value: unknown): value is DocWriteResult => isDocWriteResult(kind, op, value)
}
