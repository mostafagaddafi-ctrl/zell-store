/**
 * حالات اختبار PR-C (رصيد أول المدة + صفحة الدفعات) — منطق خالص بس، من غير داتابيز ولا شبكة.
 * بتتشغّل فعليًا بـ: pnpm --filter @zell/admin cases  (suite: openings)
 */

import type { CatalogProduct } from './catalog'
import { isInventoryLot, isLotsPage, locationLabel, parseLotStatusParam, productIdsOf, productLabel, type InventoryLot } from './lots'
import {
  buildOpeningPayload,
  emptyOpeningForm,
  openingPayloadToForm,
  openingPostIssues,
  openingTotals,
  validateOpeningDoc,
  type OpeningDocPayload,
  type OpeningFormState,
} from './openingForm'
import { isOpeningPreview, isOpeningWriteResult, isOpeningsPage, parseOpeningDetail } from './openings'
import { newBatchLine, newRollLine } from './purchaseForm'

export type OpeningCaseFailure = { name: string; expected: string; actual: string }
export type OpeningCasesReport = { passed: number; failures: OpeningCaseFailure[] }

const FILM: CatalogProduct = { id: 1, nameAr: 'فيلم', saleUnit: 'meter', isActive: true, baseWidthCm: 100, allowedWidthsCm: [100, 152] }
const TOOL: CatalogProduct = { id: 2, nameAr: 'أداة', saleUnit: 'piece', isActive: false, baseWidthCm: null, allowedWidthsCm: [] }
const CATALOG = new Map<number, CatalogProduct>([
  [1, FILM],
  [2, TOOL],
])
const TODAY = '2026-10-07'

const DOC: OpeningDocPayload = {
  locationId: 1,
  asOfDate: '2026-10-01',
  note: null,
  lines: [
    { kind: 'roll', productId: 1, widthCm: 152, rolls: [{ lengthCm: 3000 }, { lengthCm: 2750 }], lineTotalPiastres: 200000, costIsEstimated: true, estimateNote: 'سعر آخر شراء', zeroCostReason: null },
    { kind: 'batch', productId: 2, quantity: 10, lineTotalPiastres: 0, costIsEstimated: false, estimateNote: null, zeroCostReason: 'هدية قديمة' },
  ],
}

function header(status: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    docId: 5,
    docNo: 'OPN-000005',
    status,
    locationId: 1,
    locationName: 'المخزن الرئيسي',
    asOfDate: '2026-10-01',
    note: null,
    itemsTotalPiastres: 200000,
    estimatedTotalPiastres: 200000,
    lineCount: 2,
    lotCount: 0,
    postedAt: null,
    voidedAt: null,
    voidReason: null,
    discardedAt: null,
    discardReason: null,
    version: 1,
    updatedAt: '2026-10-07T00:00:00Z',
    ...patch,
  }
}

const POSTED_HEADER = header('posted', { lotCount: 3, postedAt: '2026-10-07T10:00:00Z' })
const VOIDED_HEADER = { ...POSTED_HEADER, status: 'voided', voidedAt: '2026-10-08T10:00:00Z', voidReason: 'رصيد غلط' }

const LINE_ROLL = {
  lineId: 21, lineNo: 1, kind: 'roll', productId: 1, productName: 'فيلم', saleUnit: 'meter', widthCm: 152, rollCount: 2,
  totalLengthCm: 5750, quantity: null, lineTotalPiastres: 200000, zeroCostReason: null, costIsEstimated: true, estimateNote: 'سعر آخر شراء',
}
const LINE_BATCH = {
  lineId: 22, lineNo: 2, kind: 'batch', productId: 2, productName: 'أداة', saleUnit: 'piece', widthCm: null, rollCount: null,
  totalLengthCm: null, quantity: 10, lineTotalPiastres: 0, zeroCostReason: 'هدية قديمة', costIsEstimated: false, estimateNote: null,
}

function lotRow(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    sourceKind: 'opening', locationId: 1, allocatedExtrasPiastres: 0, allocatedDiscountPiastres: 0, costIsEstimated: false,
    receivedOn: '2026-10-01', status: 'active', voidedAt: null, ...patch,
  }
}
const LOT_R1 = lotRow({ lotId: 1, lotCode: 'R-000010', lotKind: 'roll', lotSequence: 1, lineNo: 1, productId: 1, widthCm: 152, initialLengthCm: 3000, initialQuantity: null, baseCostPiastres: 104348, landedCostPiastres: 104348, costIsEstimated: true })
const LOT_R2 = lotRow({ lotId: 2, lotCode: 'R-000011', lotKind: 'roll', lotSequence: 2, lineNo: 1, productId: 1, widthCm: 152, initialLengthCm: 2750, initialQuantity: null, baseCostPiastres: 95652, landedCostPiastres: 95652, costIsEstimated: true })
const LOT_B1 = lotRow({ lotId: 3, lotCode: 'B-000010', lotKind: 'batch', lotSequence: 1, lineNo: 2, productId: 2, widthCm: null, initialLengthCm: null, initialQuantity: 10, baseCostPiastres: 0, landedCostPiastres: 0 })

function postedDetail(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { header: POSTED_HEADER, draftPayload: null, lines: [LINE_ROLL, LINE_BATCH], lots: [LOT_R1, LOT_R2, LOT_B1], ...patch }
}

function voidedLots(): Record<string, unknown>[] {
  return [LOT_R1, LOT_R2, LOT_B1].map((row) => ({ ...row, status: 'voided', voidedAt: '2026-10-08T10:00:00Z' }))
}

const LIST_LOT: InventoryLot = {
  lotId: 7, lotCode: 'R-000007', sourceKind: 'purchase', lotKind: 'roll', lotSequence: 1, productId: 1, locationId: 1,
  widthCm: 152, initialLengthCm: 3000, initialQuantity: null, baseCostPiastres: 1000, allocatedExtrasPiastres: 50,
  allocatedDiscountPiastres: 20, landedCostPiastres: 1030, costIsEstimated: false, receivedOn: '2026-10-06', status: 'active', voidedAt: null,
}

export function runOpeningCases(): OpeningCasesReport {
  const failures: OpeningCaseFailure[] = []
  let passed = 0

  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed += 1
    else failures.push({ name, expected: e, actual: a })
  }

  const line = (patch: Record<string, unknown>) => ({ ...DOC, lines: [{ kind: 'batch', productId: 2, quantity: 1, lineTotalPiastres: 500, costIsEstimated: false, estimateNote: null, zeroCostReason: null, ...patch }] })

  // ── V. التحقق البنيوي (نفس zell_inv_normalize_opening) ─────
  check('V1 valid doc', validateOpeningDoc(DOC), { ok: true, value: DOC })
  check('V2 unknown top key (supplierId)', validateOpeningDoc({ ...DOC, supplierId: 3 }).ok, false)
  check('V3 location required', validateOpeningDoc({ ...DOC, locationId: null }).ok, false)
  check('V4 bad date', validateOpeningDoc({ ...DOC, asOfDate: '2026-13-01' }).ok, false)
  check('V5 costIsEstimated required', validateOpeningDoc(line({ costIsEstimated: undefined })).ok, false)
  check('V6 estimated without note', validateOpeningDoc(line({ costIsEstimated: true })), { ok: false, message: 'بند 1: التكلفة التقديرية محتاجة ملاحظة توضّح التقدير.' })
  check('V7 note without estimate', validateOpeningDoc(line({ estimateNote: 'تقدير' })).ok, false)
  check('V8 estimate note min 3', validateOpeningDoc(line({ costIsEstimated: true, estimateNote: 'اب' })).ok, false)
  check('V9 estimated ok', validateOpeningDoc(line({ costIsEstimated: true, estimateNote: 'سعر السوق' })).ok, true)
  check('V10 zero without reason', validateOpeningDoc(line({ lineTotalPiastres: 0 })), { ok: false, message: 'بند 1: البند اللي تكلفته صفر محتاج سبب.' })
  check('V11 zero + estimated rejected', validateOpeningDoc(line({ lineTotalPiastres: 0, zeroCostReason: 'هدية', costIsEstimated: true, estimateNote: 'تقدير' })), {
    ok: false,
    message: 'بند 1: البند اللي تكلفته صفر مينفعش يكون تقديري.',
  })
  check('V12 positive with reason rejected', validateOpeningDoc(line({ zeroCostReason: 'هدية' })).ok, false)
  check('V13 charge-like key rejected', validateOpeningDoc(line({ amountPiastres: 5 })).ok, false)
  check('V14 roll keys on batch rejected', validateOpeningDoc(line({ widthCm: 100 })).ok, false)
  check('V15 empty lines allowed for a draft', validateOpeningDoc({ ...DOC, lines: [] }).ok, true)
  check('V16 note trimmed to null', ((r) => (r.ok ? r.value.note : 'bad'))(validateOpeningDoc({ ...DOC, note: '  ' })), null)
  check('V17 more than 200 lots rejected', validateOpeningDoc({
    ...DOC,
    lines: [
      { kind: 'roll', productId: 1, widthCm: 100, rolls: Array.from({ length: 200 }, () => ({ lengthCm: 1 })), lineTotalPiastres: 5, costIsEstimated: false, estimateNote: null, zeroCostReason: null },
      { kind: 'batch', productId: 2, quantity: 1, lineTotalPiastres: 5, costIsEstimated: false, estimateNote: null, zeroCostReason: null },
    ],
  }).ok, false)
  check('V18 not an object', validateOpeningDoc('x').ok, false)

  // ── T. الإجماليات وقواعد الترحيل ───────────────────────────
  check('T1 totals (all + estimated)', openingTotals(DOC), { itemsTotalPiastres: 200000, estimatedTotalPiastres: 200000, lotCount: 3 })
  check('T2 ready to post', openingPostIssues(DOC), [])
  check('T3 empty lines issue', openingPostIssues({ ...DOC, lines: [] }), ['لازم بند واحد على الأقل قبل الترحيل.'])

  // ── F. النموذج → payload ───────────────────────────────────
  {
    let n = 0
    const key = () => 'o' + String((n += 1))
    const rollLine = { ...newRollLine(key(), key()), productId: '1', widthCm: '152', rolls: [{ key: key(), meters: '30' }, { key: key(), meters: '27.5' }], total: '2000' }
    const batchLine = { ...newBatchLine(key()), productId: '2', quantity: '10', total: '0', zeroCostReason: 'هدية قديمة' }
    const form: OpeningFormState = {
      ...emptyOpeningForm({ locationId: 1, today: TODAY }),
      asOfDate: '2026-10-01',
      lines: [rollLine, batchLine],
      estimates: { [rollLine.key]: { estimated: true, note: 'سعر آخر شراء' } },
    }
    check('F1 form → exact payload', buildOpeningPayload(form, CATALOG, TODAY), { ok: true, value: DOC })
    check('F2 future date rejected', buildOpeningPayload({ ...form, asOfDate: '2026-10-08' }, CATALOG, TODAY), { ok: false, message: 'تاريخ الرصيد مينفعش يكون في المستقبل.' })
    check('F3 location required', buildOpeningPayload({ ...form, locationId: '' }, CATALOG, TODAY), { ok: false, message: 'اختار المخزن.' })
    check('F4 estimate on missing key → actual cost', ((r) => (r.ok ? r.value.lines.map((l) => l.costIsEstimated) : r.message))(buildOpeningPayload({ ...form, estimates: {} }, CATALOG, TODAY)), [false, false])
    check('F5 estimate ticked without note rejected', buildOpeningPayload({ ...form, estimates: { [rollLine.key]: { estimated: true, note: '' } } }, CATALOG, TODAY).ok, false)
    check('F6 unticked estimate ignores note', ((r) => (r.ok ? r.value.lines[0]?.estimateNote ?? null : r.message))(buildOpeningPayload({ ...form, estimates: { [rollLine.key]: { estimated: false, note: 'قديمة' } } }, CATALOG, TODAY)), null)
    check('F7 catalog check reused (roll on piece product)', buildOpeningPayload({ ...form, lines: [{ ...rollLine, productId: '2' }] }, CATALOG, TODAY), { ok: false, message: 'بند 1: اللفّات لمنتجات المتر بس.' })
    check('F8 zero + estimated rejected by validation', buildOpeningPayload({ ...form, estimates: { [batchLine.key]: { estimated: true, note: 'تقدير' } } }, CATALOG, TODAY).ok, false)
    const round = openingPayloadToForm(DOC, key)
    check('F9 payload → form → payload round trip', buildOpeningPayload(round, CATALOG, TODAY), { ok: true, value: DOC })
    check('F10 round trip keeps estimates by line key', Object.values(round.estimates), [{ estimated: true, note: 'سعر آخر شراء' }])
  }

  // ── P. تفاصيل رصيد أول المدة الصارمة ───────────────────────
  {
    const detail = (patch: Record<string, unknown>) => parseOpeningDetail(postedDetail(patch))
    check('P1 posted ok', detail({}) !== null, true)
    check('P2 posted with payload', detail({ draftPayload: DOC }), null)
    check('P3 posted line count mismatch', detail({ header: { ...POSTED_HEADER, lineCount: 3 } }), null)
    check('P4 posted lot count mismatch', detail({ header: { ...POSTED_HEADER, lotCount: 2 } }), null)
    check('P5 posted with a voided lot', detail({ lots: [LOT_R1, LOT_R2, { ...LOT_B1, status: 'voided', voidedAt: 'x' }] }), null)
    check('P6 posted without postedAt', detail({ header: { ...POSTED_HEADER, postedAt: null } }), null)
    check('P7 items total differs from lines', detail({ header: { ...POSTED_HEADER, itemsTotalPiastres: 199999, estimatedTotalPiastres: 199999 } }), null)
    check('P8 estimated total differs from estimated lines', detail({ header: { ...POSTED_HEADER, estimatedTotalPiastres: 0 } }), null)
    check('P9 estimated above items rejected', detail({ header: { ...POSTED_HEADER, estimatedTotalPiastres: 300000 } }), null)
    check('P10 lots landed sum differs from items total', detail({ lots: [LOT_R1, { ...LOT_R2, baseCostPiastres: 95651, landedCostPiastres: 95651 }, LOT_B1] }), null)
    check('P11 lot with allocation rejected', detail({ lots: [{ ...LOT_R1, allocatedExtrasPiastres: 1, landedCostPiastres: 104349 }, LOT_R2, LOT_B1] }), null)
    check('P12 purchase lot under opening rejected', detail({ lots: [{ ...LOT_R1, sourceKind: 'purchase' }, LOT_R2, LOT_B1] }), null)
    check('P13 estimated line without note', detail({ lines: [{ ...LINE_ROLL, estimateNote: null }, LINE_BATCH] }), null)
    check('P14 zero line that is estimated', detail({ lines: [LINE_ROLL, { ...LINE_BATCH, costIsEstimated: true, estimateNote: 'تقدير' }] }), null)
    check('P15 roll line with piece unit', detail({ lines: [{ ...LINE_ROLL, saleUnit: 'piece' }, LINE_BATCH] }), null)
    check('P16 roll count differs from lots', detail({ lines: [{ ...LINE_ROLL, rollCount: 3 }, LINE_BATCH] }), null)
    check('P17 lot under missing line', detail({ lots: [LOT_R1, LOT_R2, { ...LOT_B1, lineNo: 9 }] }), null)
    check('P18 bad doc number', detail({ header: { ...POSTED_HEADER, docNo: 'PUR-000005' } }), null)
    check('P19 voided ok', detail({ header: VOIDED_HEADER, lots: voidedLots() }) !== null, true)
    check('P20 voided with active lot', detail({ header: VOIDED_HEADER }), null)
    check('P21 voided without reason', detail({ header: { ...VOIDED_HEADER, voidReason: null }, lots: voidedLots() }), null)

    const draft = (h: Record<string, unknown>, patch: Record<string, unknown> = {}) =>
      parseOpeningDetail({ header: h, draftPayload: DOC, lines: [], lots: [], ...patch })
    check('P22 draft ok', draft(header('draft')) !== null, true)
    check('P23 draft without payload', draft(header('draft'), { draftPayload: null }), null)
    check('P24 draft with child rows', draft(header('draft'), { lines: [LINE_ROLL] }), null)
    check('P25 draft line count differs from payload', draft(header('draft', { lineCount: 1 })), null)
    check('P26 draft totals differ from payload', draft(header('draft', { itemsTotalPiastres: 1, estimatedTotalPiastres: 1 })), null)
    check('P27 draft with lot count', draft(header('draft', { lotCount: 1 })), null)
    check('P28 draft with invalid payload', draft(header('draft'), { draftPayload: { ...DOC, supplierId: 1 } }), null)
    const discarded = header('discarded', { discardedAt: '2026-10-08T10:00:00Z', discardReason: 'مكرر' })
    check('P29 discarded ok', draft(discarded) !== null, true)
    check('P30 discarded without discardedAt', draft({ ...discarded, discardedAt: null }), null)
    check('P31 discarded with lots', draft(discarded, { lots: [LOT_B1] }), null)
  }

  // ── G. قوائم ومعاينة ونتيجة الكتابة ────────────────────────
  check('G1 openings page ok', isOpeningsPage({ items: [header('draft')], nextBeforeId: null }), true)
  check('G2 openings page bad status', isOpeningsPage({ items: [header('cancelled')], nextBeforeId: null }), false)
  check('G3 preview ok', isOpeningPreview({
    totals: { itemsTotalPiastres: 10, estimatedTotalPiastres: 0 },
    lots: [{ lineNo: 1, lotSequence: 1, baseCostPiastres: 10, allocatedExtrasPiastres: 0, allocatedDiscountPiastres: 0, landedCostPiastres: 10 }],
  }), true)
  check('G4 preview bad', isOpeningPreview({ totals: { itemsTotalPiastres: 10 }, lots: [] }), false)
  check('G5 write result', isOpeningWriteResult({ docId: 5, docNo: 'OPN-000005', status: 'posted', version: 2, totals: {}, lots: [] }), true)

  // ── L. صفحة الدفعات ────────────────────────────────────────
  check('L1 purchase lot ok', isInventoryLot(LIST_LOT), true)
  check('L2 landed must equal base + extras − discount', isInventoryLot({ ...LIST_LOT, landedCostPiastres: 1000 }), false)
  check('L3 purchase lot cannot be estimated', isInventoryLot({ ...LIST_LOT, costIsEstimated: true }), false)
  check('L4 opening lot with allocation rejected', isInventoryLot({ ...LIST_LOT, sourceKind: 'opening' }), false)
  check('L5 opening lot estimated ok', isInventoryLot({ ...LIST_LOT, sourceKind: 'opening', allocatedExtrasPiastres: 0, allocatedDiscountPiastres: 0, landedCostPiastres: 1000, costIsEstimated: true }), true)
  check('L6 voided needs voidedAt', isInventoryLot({ ...LIST_LOT, status: 'voided' }), false)
  check('L7 active with voidedAt rejected', isInventoryLot({ ...LIST_LOT, voidedAt: '2026-10-08T00:00:00Z' }), false)
  check('L8 batch lot shape', isInventoryLot({ ...LIST_LOT, lotKind: 'batch', lotCode: 'B-000007', widthCm: null, initialLengthCm: null, initialQuantity: 4 }), true)
  check('L9 batch lot with width rejected', isInventoryLot({ ...LIST_LOT, lotKind: 'batch', lotCode: 'B-000007', initialLengthCm: null, initialQuantity: 4 }), false)
  check('L10 lot code shape', isInventoryLot({ ...LIST_LOT, lotCode: 'B-000007' }), false)
  check('L11 lots page ok', isLotsPage({ items: [LIST_LOT], nextBeforeId: 7 }), true)
  check('L12 lots page bad row', isLotsPage({ items: [{ ...LIST_LOT, status: 'gone' }], nextBeforeId: null }), false)
  check('L13 status param default active', [parseLotStatusParam(undefined), parseLotStatusParam('voided'), parseLotStatusParam('x')], ['active', 'voided', 'active'])
  check('L14 product ids unique and sorted', productIdsOf([{ ...LIST_LOT, productId: 5 }, LIST_LOT, { ...LIST_LOT, productId: 5 }]), [1, 5])
  check('L15 name fallbacks', [productLabel(new Map(), 4), locationLabel(new Map([[1, 'الرئيسي']]), 1), locationLabel(new Map(), 9)], ['منتج #4', 'الرئيسي', 'مخزن #9'])

  // ── W. نصوص ────────────────────────────────────────────────
  {
    const forbidden = ['ملغي', 'ملغى', 'ملغية', 'ملغاة']
    const texts = [
      ((r) => (r.ok ? '' : r.message))(validateOpeningDoc(line({ costIsEstimated: true }))),
      ((r) => (r.ok ? '' : r.message))(validateOpeningDoc(line({ lineTotalPiastres: 0, zeroCostReason: 'هدية', costIsEstimated: true, estimateNote: 'تقدير' }))),
      productLabel(new Map(), 1),
      locationLabel(new Map(), 1),
    ]
    check('W1 forbidden word absent', texts.filter((t) => forbidden.some((w) => t.includes(w))), [])
  }

  return { passed, failures }
}
