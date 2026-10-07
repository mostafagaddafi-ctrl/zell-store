/**
 * حالات اختبار PR-D (تحسين نماذج المخزون) — منطق خالص بس، من غير داتابيز ولا شبكة.
 * بتتشغّل فعليًا بـ: pnpm --filter @zell/admin cases  (suite: ui)
 */

import type { CatalogProduct } from './catalog'
import { keysOpenAfterCloseAll, lineIssue, lineIssues, summarizeLine } from './lineIssues'
import { costPerMeter, costPerPiece, currentSalePrice, floorDiv, groupLotsByLine, roundDiv } from './pricing'
import { acceptPreviewResult, nextPreviewTicket, payloadFingerprint } from './previewTracker'
import { filterProducts, normalizeArabicSearch, productOptionLabel } from './productSearch'
import type { LineForm } from './purchaseForm'

export type UiCaseFailure = { name: string; expected: string; actual: string }
export type UiCasesReport = { passed: number; failures: UiCaseFailure[] }

const FILM: CatalogProduct = {
  id: 1,
  nameAr: 'فيلم عازل حراري',
  saleUnit: 'meter',
  isActive: true,
  baseWidthCm: 100,
  basePricePiastres: 25000,
  allowedWidthsCm: [100, 152],
  widthOptions: [{ widthCm: 152, pricePerMeterPiastres: 36000 }],
}
const FILM_BASE_OVERRIDE: CatalogProduct = {
  ...FILM,
  id: 3,
  nameAr: 'فيلم أمان',
  widthOptions: [{ widthCm: 100, pricePerMeterPiastres: 27000 }],
}
const TOOL: CatalogProduct = {
  id: 2,
  nameAr: 'أداة تركيب إسفنجة',
  saleUnit: 'piece',
  isActive: false,
  baseWidthCm: null,
  basePricePiastres: 5000,
  allowedWidthsCm: [],
  widthOptions: [],
}
const CATALOG = new Map<number, CatalogProduct>([
  [1, FILM],
  [2, TOOL],
  [3, FILM_BASE_OVERRIDE],
])

function roll(patch: Partial<Extract<LineForm, { kind: 'roll' }>>): LineForm {
  return { key: 'r', kind: 'roll', productId: '1', widthCm: '152', rolls: [{ key: 'a', meters: '30' }, { key: 'b', meters: '27.5' }], total: '2000', zeroCostReason: '', ...patch }
}
function batch(patch: Partial<Extract<LineForm, { kind: 'batch' }>>): LineForm {
  return { key: 'b', kind: 'batch', productId: '2', quantity: '10', total: '300', zeroCostReason: '', ...patch }
}

export function runUiCases(): UiCasesReport {
  const failures: UiCaseFailure[] = []
  let passed = 0

  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed += 1
    else failures.push({ name, expected: e, actual: a })
  }

  // ── S. سعر البيع الحالي (مرجعية) ──────────────────────────
  check('S1 base width uses product price', currentSalePrice(FILM, 100), { pricePiastres: 25000, unit: 'meter', widthCm: 100 })
  check('S2 extra active width uses its own price', currentSalePrice(FILM, 152), { pricePiastres: 36000, unit: 'meter', widthCm: 152 })
  check('S3 width not offered → null', currentSalePrice(FILM, 120), null)
  check('S4 no width chosen → null', currentSalePrice(FILM, null), null)
  check('S5 piece uses product price as unit price', currentSalePrice(TOOL, null), { pricePiastres: 5000, unit: 'piece', widthCm: null })
  check('S6 active width row for base width wins (coalesce)', currentSalePrice(FILM_BASE_OVERRIDE, 100), { pricePiastres: 27000, unit: 'meter', widthCm: 100 })

  // ── C. تكاليف تقريبية بأعداد صحيحة ─────────────────────────
  check('C1 floorDiv exact', [floorDiv(10, 3), floorDiv(9, 3), floorDiv(0, 7)], [3, 3, 0])
  check('C2 floorDiv rejects bad input', [floorDiv(-1, 3), floorDiv(1, 0), floorDiv(1.5, 2), floorDiv(Number.MAX_SAFE_INTEGER, 2)], [null, null, null, null])
  check('C3 roundDiv half up', [roundDiv(5, 2), roundDiv(7, 3), roundDiv(8, 3), roundDiv(1, 3)], [3, 2, 3, 0])
  check('C4 cost per meter 200000 / 57.5 m', costPerMeter(200000, 5750), 3478)
  check('C5 cost per meter exact', costPerMeter(250000, 1000), 25000)
  check('C6 cost per meter tiny length', costPerMeter(1, 3), 33)
  check('C7 cost per meter overflow guard', costPerMeter(Number.MAX_SAFE_INTEGER, 100), null)
  check('C8 cost per meter zero length', costPerMeter(100, 0), null)
  check('C9 cost per piece', [costPerPiece(300, 10), costPerPiece(1000, 3), costPerPiece(0, 4)], [30, 333, 0])
  check('C10 float trap avoided (0.1 + 0.2 style)', costPerMeter(30, 300), 10)
  check('C11 large but safe', costPerMeter(10_000_000_000, 100_000), 10_000_000)
  {
    const grouped = groupLotsByLine([
      { lineNo: 1, lotSequence: 2, baseCostPiastres: 95652, allocatedExtrasPiastres: 2391, allocatedDiscountPiastres: 478, landedCostPiastres: 97565 },
      { lineNo: 1, lotSequence: 1, baseCostPiastres: 104348, allocatedExtrasPiastres: 2609, allocatedDiscountPiastres: 522, landedCostPiastres: 106435 },
      { lineNo: 2, lotSequence: 1, baseCostPiastres: 0, allocatedExtrasPiastres: 0, allocatedDiscountPiastres: 0, landedCostPiastres: 0 },
    ])
    check('C12 lots grouped and sorted by sequence', grouped.get(1)?.lots.map((l) => l.lotSequence), [1, 2])
    check('C13 line landed total', grouped.get(1)?.landedTotalPiastres, 204000)
    check('C14 landed per meter from DB allocation', costPerMeter(grouped.get(1)?.landedTotalPiastres ?? 0, 5750), 3548)
    check('C15 missing line → undefined', grouped.get(9), undefined)
  }

  // ── P. المعاينة وبصمة النموذج ───────────────────────────────
  {
    const fpA = payloadFingerprint({ lines: [1] })
    const fpB = payloadFingerprint({ lines: [2] })
    const t1 = nextPreviewTicket(0, fpA)
    check('P1 ticket increments', t1.requestId, 1)
    check('P2 fresh result accepted', acceptPreviewResult(t1, 1, fpA), true)
    check('P3 result after the form changed is ignored', acceptPreviewResult(t1, 1, fpB), false)
    const t2 = nextPreviewTicket(t1.requestId, fpA)
    check('P4 first request arriving after second is ignored', acceptPreviewResult(t1, t2.requestId, fpA), false)
    check('P5 second request accepted', acceptPreviewResult(t2, t2.requestId, fpA), true)
    check('P6 invalid form (no fingerprint) ignores results', acceptPreviewResult(t2, t2.requestId, null), false)
    check('P7 fingerprint stable for equal payloads', payloadFingerprint({ a: 1, b: [2] }) === payloadFingerprint({ a: 1, b: [2] }), true)
  }

  // ── Q. البحث عن المنتج ─────────────────────────────────────
  check('Q1 normalize tashkeel and alef', normalizeArabicSearch('  فِيلْمُ  أمان  '), 'فيلم امان')
  check('Q2 normalize ta marbuta and alef maqsura', normalizeArabicSearch('عازلة مستوى'), 'عازله مستوي')
  check('Q3 normalize latin case', normalizeArabicSearch('3M Film'), '3m film')
  check('Q4 filter by unit (meter)', filterProducts([FILM, TOOL, FILM_BASE_OVERRIDE], 'meter', '').map((p) => p.id), [1, 3])
  check('Q5 filter by unit (piece)', filterProducts([FILM, TOOL], 'piece', '').map((p) => p.id), [2])
  check('Q6 search tolerant to alef forms', filterProducts([FILM, FILM_BASE_OVERRIDE], 'meter', 'امان').map((p) => p.id), [3])
  check('Q7 search all tokens any order', filterProducts([FILM, FILM_BASE_OVERRIDE], 'meter', 'حراري فيلم').map((p) => p.id), [1])
  check('Q8 no match', filterProducts([FILM], 'meter', 'زجاج').length, 0)
  check('Q9 inactive product labelled', [productOptionLabel(TOOL), productOptionLabel(FILM)], ['أداة تركيب إسفنجة (موقوف)', 'فيلم عازل حراري'])
  check('Q10 inactive product still listed', filterProducts([TOOL], 'piece', 'اداه').map((p) => p.id), [2])

  // ── L. مشاكل كل بند (فتح الكارت والـfocus) ─────────────────
  check('L1 valid roll line', lineIssue(roll({}), 0, CATALOG, 'purchase'), null)
  check('L2 no product → product field', lineIssue(roll({ productId: '' }), 2, CATALOG, 'purchase'), { field: 'product', message: 'بند 3: اختار المنتج.' })
  check('L3 piece product on roll → product field', lineIssue(roll({ productId: '2' }), 0, CATALOG, 'purchase'), { field: 'product', message: 'بند 1: اللفّات لمنتجات المتر بس.' })
  check('L4 width not allowed → width field', lineIssue(roll({ widthCm: '120' }), 0, CATALOG, 'purchase'), { field: 'width', message: 'بند 1: العرض ده مش من عروض المنتج المسموحة.' })
  check('L5 bad roll length → rolls field', lineIssue(roll({ rolls: [{ key: 'a', meters: '30' }, { key: 'b', meters: '' }] }), 0, CATALOG, 'purchase'), { field: 'rolls', message: 'بند 1 لفّة 2: الطول مطلوب.' })
  check('L6 bad quantity → quantity field', lineIssue(batch({ quantity: '1.5' }), 1, CATALOG, 'purchase'), { field: 'quantity', message: 'بند 2: الكمية لازم تكون عدد صحيح.' })
  check('L7 arabic digits in quantity → quantity field', lineIssue(batch({ quantity: '١٠' }), 0, CATALOG, 'purchase')?.field, 'quantity')
  check('L8 bad total → total field', lineIssue(batch({ total: '' }), 0, CATALOG, 'purchase')?.field, 'total')
  check('L9 zero without reason → zeroReason', lineIssue(batch({ total: '0' }), 0, CATALOG, 'purchase'), { field: 'zeroReason', message: 'بند 1: البند اللي تكلفته صفر محتاج سبب.' })
  check('L10 zero with short reason → zeroReason', lineIssue(batch({ total: '0', zeroCostReason: 'اب' }), 0, CATALOG, 'purchase')?.field, 'zeroReason')
  check('L11 zero + estimated (opening) → estimate', lineIssue(batch({ total: '0', zeroCostReason: 'هدية' }), 0, CATALOG, 'opening', { estimated: true, note: 'تقدير' })?.field, 'estimate')
  check('L12 estimated without note → estimate', lineIssue(roll({}), 0, CATALOG, 'opening', { estimated: true, note: ' ' }), { field: 'estimate', message: 'بند 1: التكلفة التقديرية محتاجة ملاحظة توضّح التقدير.' })
  check('L13 estimate ignored for purchase', lineIssue(roll({}), 0, CATALOG, 'purchase', { estimated: true, note: '' }), null)
  check('L14 lineIssues keyed by line', [...lineIssues([roll({ key: 'x' }), batch({ key: 'y', quantity: '' })], CATALOG, 'purchase').keys()], ['y'])
  check('L15 close-all keeps lines with issues open', keysOpenAfterCloseAll(lineIssues([roll({ key: 'x' }), batch({ key: 'y', quantity: '' })], CATALOG, 'purchase').keys()), ['y'])

  // ── K. ملخص الكارت المقفول ─────────────────────────────────
  check('K1 roll summary', summarizeLine(roll({}), CATALOG), {
    productId: 1,
    productName: 'فيلم عازل حراري',
    kindLabel: 'لفّات (بالمتر)',
    amountText: '2 لفّة · 57.50 متر — 5750 سم',
    totalPiastres: 200000,
    unitCostPiastres: 3478,
    unitLabel: 'متر',
    salePrice: { pricePiastres: 36000, unit: 'meter', widthCm: 152 },
    measure: 5750,
  })
  check('K2 batch summary', summarizeLine(batch({}), CATALOG), {
    productId: 2,
    productName: 'أداة تركيب إسفنجة',
    kindLabel: 'قطع (بالعدد)',
    amountText: '10 قطعة',
    totalPiastres: 30000,
    unitCostPiastres: 3000,
    unitLabel: 'قطعة',
    salePrice: { pricePiastres: 5000, unit: 'piece', widthCm: null },
    measure: 10,
  })
  check('K3 incomplete roll hides unit cost', [summarizeLine(roll({ rolls: [{ key: 'a', meters: '' }] }), CATALOG).unitCostPiastres, summarizeLine(roll({ rolls: [{ key: 'a', meters: '' }] }), CATALOG).amountText], [null, '1 لفّة'])
  check('K4 no product yet', [summarizeLine(roll({ productId: '' }), CATALOG).productName, summarizeLine(roll({ productId: '' }), CATALOG).salePrice], [null, null])
  check('K5 no sale price when width missing', summarizeLine(roll({ widthCm: '' }), CATALOG).salePrice, null)

  // ── W. ممنوعات العرض ───────────────────────────────────────
  {
    const forbidden = ['ملغي', 'ملغى', 'ربح', 'هامش']
    const texts = [
      summarizeLine(roll({}), CATALOG).kindLabel,
      summarizeLine(batch({}), CATALOG).kindLabel,
      lineIssue(batch({ total: '0' }), 0, CATALOG, 'purchase')?.message ?? '',
      productOptionLabel(TOOL),
    ]
    check('W1 no forbidden words (no profit/margin wording)', texts.filter((t) => forbidden.some((w) => t.includes(w))), [])
  }

  return { passed, failures }
}
