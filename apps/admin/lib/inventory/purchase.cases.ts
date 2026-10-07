/**
 * حالات اختبار PR-B (فواتير الشراء) — منطق خالص بس، من غير أي نداء داتابيز ولا شبكة.
 * بتتشغّل فعليًا بـ: pnpm --filter @zell/admin cases  (suite: purchases)
 */

import type { CatalogProduct } from './catalog'
import {
  LATIN_DIGITS_MESSAGE,
  cmToMetersText,
  formatMetersAndCm,
  formatPiastresExact,
  parseMeters,
  parsePounds,
  parseQuantity,
  piastresToPoundsText,
} from './money'
import { UNSAVED_CHANGES_MESSAGE, shouldGuardClick, type ClickInfo } from './navigation'
import { abandonIntent, beginIntent, initialIntent, reopenAfterReconcile, resetAfterDone, type IntentState } from './intent'
import {
  CHARGE_KIND_LABELS,
  buildPurchasePayload,
  cairoToday,
  draftTotals,
  emptyPurchaseForm,
  isValidIsoDate,
  newBatchLine,
  newCharge,
  newRollLine,
  normalizeReason,
  payloadToForm,
  postReadinessIssues,
  validatePurchaseDoc,
  type PurchaseDocPayload,
  type PurchaseFormState,
} from './purchaseForm'
import {
  isLocationsPage,
  isPurchasePreview,
  isPurchaseWriteResult,
  isPurchasesPage,
  parseDocStatusParam,
  parseIdParam,
  parsePurchaseDetail,
} from './purchases'
import { canConfirm, createWriteLock, releaseAfterReconcile, settleLockedIntent, startLockedIntent } from './writeLock'

export type PurchaseCaseFailure = { name: string; expected: string; actual: string }
export type PurchaseCasesReport = { passed: number; failures: PurchaseCaseFailure[] }

const FILM: CatalogProduct = { id: 1, nameAr: 'فيلم', saleUnit: 'meter', isActive: true, baseWidthCm: 100, allowedWidthsCm: [100, 152] }
const TOOL: CatalogProduct = { id: 2, nameAr: 'أداة', saleUnit: 'piece', isActive: false, baseWidthCm: null, allowedWidthsCm: [] }
const CATALOG = new Map<number, CatalogProduct>([
  [1, FILM],
  [2, TOOL],
])
const TODAY = '2026-10-07'

const VALID_DOC: PurchaseDocPayload = {
  supplierId: 3,
  supplierRef: 'INV-77',
  locationId: 1,
  docDate: '2026-10-06',
  note: null,
  charges: [{ kind: 'transport', amountPiastres: 5000, reference: null, note: null }],
  supplierDiscountPiastres: 1000,
  lines: [
    { kind: 'roll', productId: 1, widthCm: 152, rolls: [{ lengthCm: 3000 }, { lengthCm: 2750 }], lineTotalPiastres: 200000, zeroCostReason: null },
    { kind: 'batch', productId: 2, quantity: 10, lineTotalPiastres: 0, zeroCostReason: 'هدية من المورد' },
  ],
}

function header(status: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    docId: 9,
    docNo: 'PUR-000009',
    status,
    supplierId: 3,
    supplierName: 'مورد',
    supplierRef: null,
    locationId: 1,
    locationName: 'المخزن الرئيسي',
    docDate: '2026-10-06',
    note: null,
    supplierDiscountPiastres: 0,
    itemsSubtotalPiastres: 200000,
    extrasTotalPiastres: 0,
    totalCostPiastres: 200000,
    lineCount: 1,
    chargeCount: 0,
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

// ── fixtures مرحّل/مُبطَل صحيحة بالحرف من قيود 0020 ──────────────────
const POSTED_HEADER = header('posted', {
  lineCount: 2,
  chargeCount: 1,
  lotCount: 3,
  postedAt: '2026-10-07T10:00:00Z',
  itemsSubtotalPiastres: 200000,
  extrasTotalPiastres: 5000,
  supplierDiscountPiastres: 1000,
  totalCostPiastres: 204000,
})
const VOIDED_HEADER = { ...POSTED_HEADER, status: 'voided', voidedAt: '2026-10-08T10:00:00Z', voidReason: 'غلط في الكمية' }
const DISCARDED_HEADER = header('discarded', { lineCount: 2, chargeCount: 1, discardedAt: '2026-10-08T10:00:00Z', discardReason: 'مكررة' })

const LINE_ROLL = {
  lineId: 11, lineNo: 1, kind: 'roll', productId: 1, productName: 'فيلم', saleUnit: 'meter', widthCm: 152, rollCount: 2,
  totalLengthCm: 5750, quantity: null, lineTotalPiastres: 200000, zeroCostReason: null, allocatedExtrasPiastres: 5000,
  allocatedDiscountPiastres: 1000, landedTotalPiastres: 204000,
}
const LINE_BATCH = {
  lineId: 12, lineNo: 2, kind: 'batch', productId: 2, productName: 'أداة', saleUnit: 'piece', widthCm: null, rollCount: null,
  totalLengthCm: null, quantity: 10, lineTotalPiastres: 0, zeroCostReason: 'هدية من المورد', allocatedExtrasPiastres: 0,
  allocatedDiscountPiastres: 0, landedTotalPiastres: 0,
}
const CHARGE_1 = { chargeNo: 1, kind: 'transport', amountPiastres: 5000, reference: null, note: null }

function lotRow(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    sourceKind: 'purchase', locationId: 1, baseCostPiastres: 100, allocatedExtrasPiastres: 0, allocatedDiscountPiastres: 0,
    landedCostPiastres: 100, costIsEstimated: false, receivedOn: '2026-10-06', status: 'active', voidedAt: null, ...patch,
  }
}
const LOT_R1 = lotRow({ lotId: 1, lotCode: 'R-000001', lotKind: 'roll', lotSequence: 1, lineNo: 1, productId: 1, widthCm: 152, initialLengthCm: 3000, initialQuantity: null })
const LOT_R2 = lotRow({ lotId: 2, lotCode: 'R-000002', lotKind: 'roll', lotSequence: 2, lineNo: 1, productId: 1, widthCm: 152, initialLengthCm: 2750, initialQuantity: null })
const LOT_B1 = lotRow({ lotId: 3, lotCode: 'B-000001', lotKind: 'batch', lotSequence: 1, lineNo: 2, productId: 2, widthCm: null, initialLengthCm: null, initialQuantity: 10 })

function postedDetail(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { header: POSTED_HEADER, draftPayload: null, lines: [LINE_ROLL, LINE_BATCH], charges: [CHARGE_1], lots: [LOT_R1, LOT_R2, LOT_B1], ...patch }
}

function voidedLots(): Record<string, unknown>[] {
  return [LOT_R1, LOT_R2, LOT_B1].map((row) => ({ ...row, status: 'voided', voidedAt: '2026-10-08T10:00:00Z' }))
}

function click(patch: Partial<ClickInfo>): ClickInfo {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target: null,
    download: false,
    href: '/inventory/suppliers',
    currentHref: 'https://admin.example.com/inventory/purchases/new',
    ...patch,
  }
}

export function runPurchaseCases(): PurchaseCasesReport {
  const failures: PurchaseCaseFailure[] = []
  let passed = 0

  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed += 1
    else failures.push({ name, expected: e, actual: a })
  }

  const money = (text: string, allowZero = false, required = true) =>
    parsePounds(text, { name: '', allowZero, required })

  // ── M. الفلوس ──────────────────────────────────────────────
  check('M1 whole pounds', money('1250'), { ok: true, value: 125000 })
  check('M2 one decimal', money('1250.5'), { ok: true, value: 125050 })
  check('M3 two decimals', money('0.01'), { ok: true, value: 1 })
  check('M4 float trap 0.29 exact', money('0.29'), { ok: true, value: 29 })
  check('M5 float trap 1.15 exact', money('1.15'), { ok: true, value: 115 })
  check('M6 three decimals rejected', money('1.005').ok, false)
  check('M7 comma rejected', money('1,250').ok, false)
  check('M8 negative rejected', money('-5').ok, false)
  check('M9 arabic digits rejected', money('١٢٣'), { ok: false, message: LATIN_DIGITS_MESSAGE })
  check('M10 zero rejected when not allowed', money('0').ok, false)
  check('M11 zero allowed for line total', money('0', true), { ok: true, value: 0 })
  check('M12 empty optional → 0', money('', true, false), { ok: true, value: 0 })
  check('M13 empty required rejected', money('').ok, false)
  check('M14 max 100,000,000 pounds ok', money('100000000'), { ok: true, value: 10000000000 })
  check('M15 above max rejected', money('100000000.01').ok, false)
  check('M16 spaces trimmed', money('  75.25 '), { ok: true, value: 7525 })
  check('M17 trailing dot rejected', money('5.').ok, false)
  check('M18 leading dot rejected', money('.5').ok, false)
  check('M19 piastres → text whole', piastresToPoundsText(125000), '1250')
  check('M20 piastres → text fraction', piastresToPoundsText(125005), '1250.05')
  check('M21 exact format', formatPiastresExact(123456789), '1,234,567.89 ج.م')
  check('M22 exact format whole', formatPiastresExact(500000), '5,000 ج.م')

  // ── L. الأطوال (متر → سم) والكميات ─────────────────────────
  check('L1 27.5 m → 2750 cm', parseMeters('27.5', ''), { ok: true, value: 2750 })
  check('L2 27.50 m → 2750 cm', parseMeters('27.50', ''), { ok: true, value: 2750 })
  check('L3 0.01 m → 1 cm', parseMeters('0.01', ''), { ok: true, value: 1 })
  check('L4 1000 m ok', parseMeters('1000', ''), { ok: true, value: 100000 })
  check('L5 1000.01 m rejected', parseMeters('1000.01', '').ok, false)
  check('L6 zero rejected', parseMeters('0', '').ok, false)
  check('L7 three decimals rejected', parseMeters('27.505', '').ok, false)
  check('L8 float trap 0.07 exact', parseMeters('0.07', ''), { ok: true, value: 7 })
  check('L9 arabic digits rejected', parseMeters('٢٧', ''), { ok: false, message: LATIN_DIGITS_MESSAGE })
  check('L10 cm → meters text', cmToMetersText(2750), '27.50')
  check('L11 dual format', formatMetersAndCm(2750), '27.50 متر — 2750 سم')
  check('L12 dual format small', formatMetersAndCm(7), '0.07 متر — 7 سم')
  check('Q1 quantity ok', parseQuantity('10', ''), { ok: true, value: 10 })
  check('Q2 quantity zero rejected', parseQuantity('0', '').ok, false)
  check('Q3 quantity fraction rejected', parseQuantity('1.5', '').ok, false)
  check('Q4 quantity max ok', parseQuantity('1000000', ''), { ok: true, value: 1000000 })
  check('Q5 quantity above max rejected', parseQuantity('1000001', '').ok, false)

  // ── V. التحقق البنيوي (نفس zell_inv_normalize_purchase) ─────
  check('V1 valid doc', validatePurchaseDoc(VALID_DOC), { ok: true, value: VALID_DOC })
  check('V2 unknown top key', validatePurchaseDoc({ ...VALID_DOC, extra: 1 }).ok, false)
  check('V3 missing location', validatePurchaseDoc({ ...VALID_DOC, locationId: null }).ok, false)
  check('V4 supplier optional (null)', validatePurchaseDoc({ ...VALID_DOC, supplierId: null }).ok, true)
  check('V5 bad date', validatePurchaseDoc({ ...VALID_DOC, docDate: '2026-02-30' }).ok, false)
  check('V6 date format', validatePurchaseDoc({ ...VALID_DOC, docDate: '7/10/2026' }).ok, false)
  check('V7 supplierRef 61 rejected', validatePurchaseDoc({ ...VALID_DOC, supplierRef: 'x'.repeat(61) }).ok, false)
  check('V8 note trimmed to null', validatePurchaseDoc({ ...VALID_DOC, note: ' \n ' }).ok && true, true)
  check('V9 negative discount rejected', validatePurchaseDoc({ ...VALID_DOC, supplierDiscountPiastres: -1 }).ok, false)
  check('V10 fractional amount rejected', validatePurchaseDoc({ ...VALID_DOC, supplierDiscountPiastres: 1.5 }).ok, false)
  check(
    'V11 charge zero amount rejected',
    validatePurchaseDoc({ ...VALID_DOC, charges: [{ kind: 'transport', amountPiastres: 0, reference: null, note: null }] }).ok,
    false,
  )
  check(
    'V12 charge other needs note',
    validatePurchaseDoc({ ...VALID_DOC, charges: [{ kind: 'other', amountPiastres: 10, reference: null, note: null }] }).ok,
    false,
  )
  check(
    'V13 charge note min 3',
    validatePurchaseDoc({ ...VALID_DOC, charges: [{ kind: 'other', amountPiastres: 10, reference: null, note: 'اب' }] }).ok,
    false,
  )
  check(
    'V14 charge unknown key',
    validatePurchaseDoc({ ...VALID_DOC, charges: [{ kind: 'transport', amountPiastres: 10, x: 1 }] }).ok,
    false,
  )
  check(
    'V15 51 charges rejected',
    validatePurchaseDoc({
      ...VALID_DOC,
      charges: Array.from({ length: 51 }, () => ({ kind: 'transport', amountPiastres: 1, reference: null, note: null })),
    }).ok,
    false,
  )
  check(
    'V16 zero total without reason → rule',
    validatePurchaseDoc({ ...VALID_DOC, lines: [{ kind: 'batch', productId: 2, quantity: 1, lineTotalPiastres: 0, zeroCostReason: null }] }),
    { ok: false, message: 'بند 1: البند اللي تكلفته صفر محتاج سبب.' },
  )
  check(
    'V17 reason with positive total → rule',
    validatePurchaseDoc({ ...VALID_DOC, lines: [{ kind: 'batch', productId: 2, quantity: 1, lineTotalPiastres: 5, zeroCostReason: 'سبب ما' }] }).ok,
    false,
  )
  check(
    'V18 roll line needs ≥1 roll',
    validatePurchaseDoc({ ...VALID_DOC, lines: [{ kind: 'roll', productId: 1, widthCm: 100, rolls: [], lineTotalPiastres: 5, zeroCostReason: null }] }).ok,
    false,
  )
  check(
    'V19 roll key on batch rejected',
    validatePurchaseDoc({ ...VALID_DOC, lines: [{ kind: 'batch', productId: 2, quantity: 1, widthCm: 100, lineTotalPiastres: 5, zeroCostReason: null }] }).ok,
    false,
  )
  check(
    'V20 roll length above 100000 rejected',
    validatePurchaseDoc({ ...VALID_DOC, lines: [{ kind: 'roll', productId: 1, widthCm: 100, rolls: [{ lengthCm: 100001 }], lineTotalPiastres: 5, zeroCostReason: null }] }).ok,
    false,
  )
  check(
    'V21 width above 1000 rejected',
    validatePurchaseDoc({ ...VALID_DOC, lines: [{ kind: 'roll', productId: 1, widthCm: 1001, rolls: [{ lengthCm: 1 }], lineTotalPiastres: 5, zeroCostReason: null }] }).ok,
    false,
  )
  check(
    'V22 more than 200 lots rejected',
    validatePurchaseDoc({
      ...VALID_DOC,
      lines: [
        { kind: 'roll', productId: 1, widthCm: 100, rolls: Array.from({ length: 200 }, () => ({ lengthCm: 1 })), lineTotalPiastres: 5, zeroCostReason: null },
        { kind: 'batch', productId: 2, quantity: 1, lineTotalPiastres: 5, zeroCostReason: null },
      ],
    }),
    { ok: false, message: 'عدد الدفعات (اللفّات + بنود القطع) لحد 200 في الفاتورة.' },
  )
  check('V23 empty lines allowed for a draft', validatePurchaseDoc({ ...VALID_DOC, lines: [] }).ok, true)
  check('V24 NFC + trim on text', validatePurchaseDoc({ ...VALID_DOC, supplierRef: '  Cafe\u0301 ' }).ok ? (validatePurchaseDoc({ ...VALID_DOC, supplierRef: '  Cafe\u0301 ' }) as { ok: true; value: PurchaseDocPayload }).value.supplierRef : null, 'Caf\u00e9')
  check('V25 not an object', validatePurchaseDoc([]).ok, false)
  check('V26 productId above int4 rejected', validatePurchaseDoc({ ...VALID_DOC, lines: [{ kind: 'batch', productId: 2147483648, quantity: 1, lineTotalPiastres: 5, zeroCostReason: null }] }).ok, false)

  // ── T. الإجماليات وقواعد الترحيل ───────────────────────────
  check('T1 draft totals', draftTotals(VALID_DOC), {
    itemsSubtotalPiastres: 200000,
    extrasTotalPiastres: 5000,
    supplierDiscountPiastres: 1000,
    totalCostPiastres: 204000,
    lotCount: 3,
  })
  check('T2 ready to post', postReadinessIssues(VALID_DOC), [])
  check('T3 empty lines issue', postReadinessIssues({ ...VALID_DOC, lines: [], supplierDiscountPiastres: 0, charges: [] }), [
    'لازم بند واحد على الأقل قبل الترحيل.',
  ])
  check(
    'T4 allocation base zero',
    postReadinessIssues({
      ...VALID_DOC,
      supplierDiscountPiastres: 0,
      lines: [{ kind: 'batch', productId: 2, quantity: 1, lineTotalPiastres: 0, zeroCostReason: 'هدية' }],
    }),
    ['مينفعش توزيع المصاريف أو الخصم وإجمالي البنود صفر.'],
  )
  check('T5 discount equal to items is too large', postReadinessIssues({ ...VALID_DOC, supplierDiscountPiastres: 200000 }), [
    'خصم المورد لازم يكون أقل من إجمالي البنود.',
  ])
  check('T6 discount just below items ok', postReadinessIssues({ ...VALID_DOC, supplierDiscountPiastres: 199999 }), [])

  // ── F. النموذج → payload (الكتالوج والتاريخ) ───────────────
  {
    let n = 0
    const key = () => 'k' + String((n += 1))
    const form: PurchaseFormState = {
      ...emptyPurchaseForm({ locationId: 1, today: TODAY }),
      supplierId: '3',
      supplierRef: 'INV-77',
      docDate: '2026-10-06',
      discount: '10',
      charges: [{ ...newCharge(key()), amount: '50' }],
      lines: [
        { ...newRollLine(key(), key()), productId: '1', widthCm: '152', rolls: [{ key: key(), meters: '30' }, { key: key(), meters: '27.5' }], total: '2000' },
        { ...newBatchLine(key()), productId: '2', quantity: '10', total: '0', zeroCostReason: 'هدية من المورد' },
      ],
    }
    check('F1 form → exact payload', buildPurchasePayload(form, CATALOG, TODAY), { ok: true, value: VALID_DOC })
    check('F2 future date rejected', buildPurchasePayload({ ...form, docDate: '2026-10-08' }, CATALOG, TODAY), {
      ok: false,
      message: 'تاريخ الفاتورة مينفعش يكون في المستقبل.',
    })
    check('F3 today allowed', buildPurchasePayload({ ...form, docDate: TODAY }, CATALOG, TODAY).ok, true)
    check('F4 location required', buildPurchasePayload({ ...form, locationId: '' }, CATALOG, TODAY), { ok: false, message: 'اختار المخزن.' })
    check(
      'F5 roll on piece product rejected',
      buildPurchasePayload({ ...form, lines: [{ ...newRollLine('a', 'b'), productId: '2', widthCm: '100', rolls: [{ key: 'c', meters: '1' }], total: '5' }] }, CATALOG, TODAY),
      { ok: false, message: 'بند 1: اللفّات لمنتجات المتر بس.' },
    )
    check(
      'F6 batch on meter product rejected',
      buildPurchasePayload({ ...form, lines: [{ ...newBatchLine('a'), productId: '1', quantity: '1', total: '5' }] }, CATALOG, TODAY),
      { ok: false, message: 'بند 1: القطع لمنتجات العدد بس.' },
    )
    check(
      'F7 width not allowed rejected',
      buildPurchasePayload({ ...form, lines: [{ ...newRollLine('a', 'b'), productId: '1', widthCm: '120', rolls: [{ key: 'c', meters: '1' }], total: '5' }] }, CATALOG, TODAY),
      { ok: false, message: 'بند 1: العرض ده مش من عروض المنتج المسموحة.' },
    )
    check(
      'F8 base width allowed',
      buildPurchasePayload({ ...form, lines: [{ ...newRollLine('a', 'b'), productId: '1', widthCm: '100', rolls: [{ key: 'c', meters: '1' }], total: '5' }] }, CATALOG, TODAY).ok,
      true,
    )
    check(
      'F9 unknown product rejected',
      buildPurchasePayload({ ...form, lines: [{ ...newBatchLine('a'), productId: '99', quantity: '1', total: '5' }] }, CATALOG, TODAY),
      { ok: false, message: 'بند 1: المنتج مش موجود في الكتالوج.' },
    )
    check('F10 inactive product still allowed', buildPurchasePayload({ ...form, lines: [{ ...newBatchLine('a'), productId: '2', quantity: '1', total: '5' }] }, CATALOG, TODAY).ok, true)
    check(
      'F11 reason dropped when total > 0',
      (() => {
        const r = buildPurchasePayload({ ...form, lines: [{ ...newBatchLine('a'), productId: '2', quantity: '1', total: '5', zeroCostReason: 'كان صفر' }] }, CATALOG, TODAY)
        return r.ok ? ((line) => (line ? line.zeroCostReason : 'missing'))(r.value.lines[0]) : r.message
      })(),
      null,
    )
    check('F12 bad roll length message names line and roll', buildPurchasePayload({ ...form, lines: [{ ...newRollLine('a', 'b'), productId: '1', widthCm: '100', rolls: [{ key: 'c', meters: '' }], total: '5' }] }, CATALOG, TODAY), {
      ok: false,
      message: 'بند 1 لفّة 1: الطول مطلوب.',
    })
    check('F13 supplier optional', buildPurchasePayload({ ...form, supplierId: '' }, CATALOG, TODAY).ok, true)
    check('F14 arabic digits in total rejected', buildPurchasePayload({ ...form, discount: '١٠' }, CATALOG, TODAY).ok, false)
    const roundTrip = payloadToForm(VALID_DOC, key)
    check('F15 payload → form → payload round trip', buildPurchasePayload(roundTrip, CATALOG, TODAY), { ok: true, value: VALID_DOC })
    check('F16 round trip roll meters text', ((line) => (line && line.kind === 'roll' ? line.rolls.map((r) => r.meters) : null))(roundTrip.lines[0]), ['30', '27.50'])
  }

  // ── D. التواريخ ────────────────────────────────────────────
  check('D1 valid date', isValidIsoDate('2026-10-07'), true)
  check('D2 feb 29 non-leap rejected', isValidIsoDate('2026-02-29'), false)
  check('D3 feb 29 leap ok', isValidIsoDate('2028-02-29'), true)
  check('D4 cairo today late UTC evening is next day', cairoToday(new Date('2026-10-06T22:30:00Z')), '2026-10-07')
  check('D5 cairo today morning UTC', cairoToday(new Date('2026-10-07T05:00:00Z')), '2026-10-07')

  // ── R. الأسباب ─────────────────────────────────────────────
  check('R1 discard reason required', normalizeReason('  ', 'discard').ok, false)
  check('R2 discard 1 char ok (UI rule)', normalizeReason('x', 'discard'), { ok: true, value: 'x' })
  check('R3 void needs 3 chars (DB rule)', normalizeReason('اب', 'void').ok, false)
  check('R4 void 3 chars ok', normalizeReason('ابت', 'void').ok, true)
  check('R5 300 ok', normalizeReason('س'.repeat(300), 'void').ok, true)
  check('R6 301 rejected', normalizeReason('س'.repeat(301), 'discard').ok, false)
  check('R7 trimmed', normalizeReason('  غلط في الكمية  ', 'void'), { ok: true, value: 'غلط في الكمية' })
  check('R8 non-string rejected', normalizeReason(5, 'void').ok, false)

  // ── G. فحص شكل الردود ──────────────────────────────────────
  check('G1 purchases page ok', isPurchasesPage({ items: [header('draft')], nextBeforeId: null }), true)
  check('G2 purchases page bad status', isPurchasesPage({ items: [header('cancelled')], nextBeforeId: null }), false)
  check('G3 purchases page next id', isPurchasesPage({ items: [], nextBeforeId: 5 }), true)
  check(
    'G4 draft detail parsed',
    parsePurchaseDetail({ header: header('draft', { lineCount: 2, chargeCount: 1 }), draftPayload: VALID_DOC, lines: [], charges: [], lots: [] })?.draftPayload,
    VALID_DOC,
  )
  check('G5 draft without payload rejected', parsePurchaseDetail({ header: header('draft'), draftPayload: null, lines: [], charges: [], lots: [] }), null)
  check('G6 posted detail (full fixture) ok', parsePurchaseDetail(postedDetail()) !== null, true)
  check(
    'G7 detail with invalid payload rejected',
    parsePurchaseDetail({ header: header('draft'), draftPayload: { ...VALID_DOC, extra: 1 }, lines: [], charges: [], lots: [] }),
    null,
  )
  check('G8 posted detail keeps all lots', parsePurchaseDetail(postedDetail())?.lots.length, 3)
  check(
    'G9 preview ok',
    isPurchasePreview({
      totals: { itemsSubtotalPiastres: 10, extrasTotalPiastres: 0, supplierDiscountPiastres: 0, totalCostPiastres: 10 },
      lots: [{ lineNo: 1, lotSequence: 1, baseCostPiastres: 10, allocatedExtrasPiastres: 0, allocatedDiscountPiastres: 0, landedCostPiastres: 10 }],
    }),
    true,
  )
  check('G10 preview bad', isPurchasePreview({ totals: {}, lots: [] }), false)
  check('G11 write result', isPurchaseWriteResult({ docId: 9, docNo: 'PUR-000009', status: 'draft', version: 1, totals: {} }), true)
  check('G12 write result replay', isPurchaseWriteResult({ docId: 9, docNo: 'PUR-000009', status: 'posted', version: 2, replayed: true }), true)
  check('G13 write result bad', isPurchaseWriteResult({ docId: 9, status: 'draft', version: 1 }), false)
  check(
    'G14 locations page',
    isLocationsPage({ items: [{ locationId: 1, code: 'MAIN', name: 'المخزن الرئيسي', isDefault: true, isActive: true, version: 1, updatedAt: 'x' }], nextAfterId: null }),
    true,
  )
  check('G15 status param', [parseDocStatusParam('posted'), parseDocStatusParam('cancelled'), parseDocStatusParam(['draft'])], ['posted', null, null])
  check('G16 id param', [parseIdParam('12'), parseIdParam('0'), parseIdParam('1e3'), parseIdParam('-1'), parseIdParam(undefined)], [12, null, null, null, null])

  // ── N. حماية التنقل ────────────────────────────────────────
  check('N1 internal link guarded', shouldGuardClick(click({})), true)
  check('N2 ctrl click not guarded', shouldGuardClick(click({ ctrlKey: true })), false)
  check('N3 meta click not guarded', shouldGuardClick(click({ metaKey: true })), false)
  check('N4 middle button not guarded', shouldGuardClick(click({ button: 1 })), false)
  check('N5 target _blank not guarded', shouldGuardClick(click({ target: '_blank' })), false)
  check('N6 target _self guarded', shouldGuardClick(click({ target: '_self' })), true)
  check('N7 download not guarded', shouldGuardClick(click({ download: true })), false)
  check('N8 external origin not guarded (beforeunload)', shouldGuardClick(click({ href: 'https://example.org/x' })), false)
  check('N9 same page not guarded', shouldGuardClick(click({ href: '/inventory/purchases/new' })), false)
  check('N10 hash on same page not guarded', shouldGuardClick(click({ href: '#lines' })), false)
  check('N11 same path different query guarded', shouldGuardClick(click({ href: '/inventory/purchases/new?x=1' })), true)
  check('N12 already prevented not guarded', shouldGuardClick(click({ defaultPrevented: true })), false)
  check('N13 no href not guarded', shouldGuardClick(click({ href: null })), false)
  check('N14 mailto not guarded', shouldGuardClick(click({ href: 'mailto:a@b.c' })), false)
  check('N15 absolute same origin guarded', shouldGuardClick(click({ href: 'https://admin.example.com/orders' })), true)

  // ── W. نصوص ────────────────────────────────────────────────
  check('W1 charge kinds labelled', Object.keys(CHARGE_KIND_LABELS), ['transport', 'loading', 'customs', 'other'])
  {
    const forbidden = ['ملغي', 'ملغى', 'ملغية', 'ملغاة']
    const texts = [UNSAVED_CHANGES_MESSAGE, ...Object.values(CHARGE_KIND_LABELS)]
    check('W2 forbidden word absent', texts.filter((t) => forbidden.some((w) => t.includes(w))), [])
  }

  // ── I. انتقالات النية الجديدة (المصالحة وما بعد النجاح) ─────
  {
    const id = '6f1c2a4e-3b5d-4c7e-9f10-1a2b3c4d5e6f'
    const editing = initialIntent<{ n: number }>()
    const abandoned: IntentState<{ n: number }> = { phase: 'abandoned' }
    const done: IntentState<{ n: number }> = { phase: 'done', commandId: id }
    const unresolved: IntentState<{ n: number }> = { phase: 'unresolved', commandId: id, payload: { n: 1 }, attempt: 1, hard: false, message: 'x' }
    check('I1 reopen after reconcile from abandoned', reopenAfterReconcile(abandoned), { phase: 'editing', failure: null })
    check('I2 reopen refused from unresolved (no reconcile yet)', reopenAfterReconcile(unresolved), null)
    check('I3 reopen refused from editing', reopenAfterReconcile(editing), null)
    check('I4 reset after done', resetAfterDone(done), { phase: 'editing', failure: null })
    check('I5 reset refused from unresolved', resetAfterDone(unresolved), null)
    check('I6 abandon then reopen then new id', (() => {
      const a = abandonIntent(unresolved)
      const r = a ? reopenAfterReconcile(a) : null
      const b = r ? beginIntent(r, { n: 2 }, '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b') : null
      return b && b.phase === 'submitting' ? b.commandId : null
    })(), '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b')
  }

  // ── K. القفل المتزامن للكتابة (ملاحظة المراجعة · 1) ─────────
  {
    type Ref = { docId: number; version: number }
    const A = '11111111-1111-4111-8111-111111111111'
    const B = '22222222-2222-4222-8222-222222222222'
    const C = '33333333-3333-4333-8333-333333333333'
    const lock = createWriteLock()
    let post = initialIntent<Ref>()
    let discard = initialIntent<Ref>()

    const started = startLockedIntent(lock, 'post', post, { docId: 9, version: 1 }, A)
    check('K1 first post starts and holds the lock', [started !== null, lock.holder()], [true, 'post'])
    if (started) post = started
    check('K2 double submit of the same op starts once', startLockedIntent(lock, 'post', post, { docId: 9, version: 1 }, B), null)
    check('K3 post + discard in the same tick: discard refused', startLockedIntent(lock, 'discard', discard, { docId: 9, version: 1 }, B), null)
    check('K4 refused start leaves lock with post', lock.holder(), 'post')
    check('K5 stale settle (other key) keeps the lock', [settleLockedIntent(lock, 'post', post, B, { ok: true }).phase, lock.holder()], ['submitting', 'post'])

    post = settleLockedIntent(lock, 'post', post, A, { ok: false, code: 'VALIDATION', message: 'x', resolution: 'rejected' })
    check('K6 clear rejection releases the lock', [post.phase, lock.holder()], ['editing', null])

    const d = startLockedIntent(lock, 'discard', discard, { docId: 9, version: 1 }, C)
    check('K7 discard can start after release', [d !== null, lock.holder()], [true, 'discard'])
    if (d) discard = d
    discard = settleLockedIntent(lock, 'discard', discard, C, { ok: false, code: 'INTERNAL', message: 'x', resolution: 'unresolved' })
    check('K8 unresolved keeps the lock', [discard.phase, lock.holder()], ['unresolved', 'discard'])
    check('K9 post refused while discard unresolved', startLockedIntent(lock, 'post', post, { docId: 9, version: 1 }, B), null)
    const abandoned = abandonIntent(discard)
    if (abandoned) discard = abandoned
    check('K10 abandon keeps the lock until reconcile', [discard.phase, lock.holder()], ['abandoned', 'discard'])
    lock.release('post')
    check('K11 release by a non-holder is ignored', lock.holder(), 'discard')
    discard = releaseAfterReconcile(lock, 'discard', discard)
    check('K12 reconcile reopens and releases', [discard.phase, lock.holder()], ['editing', null])

    const p2 = startLockedIntent(lock, 'post', post, { docId: 9, version: 1 }, B)
    if (p2) post = p2
    post = settleLockedIntent(lock, 'post', post, B, { ok: true })
    check('K13 done keeps the lock until reconcile', [post.phase, lock.holder()], ['done', 'post'])
    post = releaseAfterReconcile(lock, 'post', post)
    check('K14 reconcile after done releases', [post.phase, lock.holder()], ['editing', null])

    // بوابة التأكيد وقت الضغط (confirm قديم بعد ما الحالة اتغيرت مايبدأش)
    const clear = { mutationsOn: true, reconciling: false, lockHolder: null, blockedReason: null }
    check('K15 confirm gate: all clear', canConfirm(clear), true)
    check('K16 stale confirm after edits (dirty → blocked)', canConfirm({ ...clear, blockedReason: 'احفظ التعديلات الأول' }), false)
    check('K17 confirm while another op holds the lock', canConfirm({ ...clear, lockHolder: 'save' }), false)
    check('K18 confirm during reconcile', canConfirm({ ...clear, reconciling: true }), false)
    check('K19 confirm with mutations off', canConfirm({ ...clear, mutationsOn: false }), false)

    // الإبطال: تأكيد مرتين
    const voidLock = createWriteLock()
    let voiding = initialIntent<Ref & { reason: string }>()
    const v1 = startLockedIntent(voidLock, 'void', voiding, { docId: 9, version: 2, reason: 'غلط' }, A)
    if (v1) voiding = v1
    const v2 = startLockedIntent(voidLock, 'void', voiding, { docId: 9, version: 2, reason: 'غلط' }, B)
    check('K20 void double confirm starts once', [v1 !== null, v2, voidLock.holder()], [true, null, 'void'])
  }

  // ── P. فحص تفاصيل الفاتورة الصارم (ملاحظة المراجعة · 2) ───────
  {
    const detail = (patch: Record<string, unknown>) => parsePurchaseDetail(postedDetail(patch))
    check('P1 posted ok', detail({}) !== null, true)
    check('P2 posted with draftPayload rejected', detail({ draftPayload: VALID_DOC }), null)
    check('P3 posted line count mismatch', detail({ header: { ...POSTED_HEADER, lineCount: 3 } }), null)
    check('P4 posted with a voided lot', detail({ lots: [LOT_R1, LOT_R2, { ...LOT_B1, status: 'voided' }] }), null)
    check('P5 posted without postedAt', detail({ header: { ...POSTED_HEADER, postedAt: null } }), null)
    check('P6 posted header total mismatch', detail({ header: { ...POSTED_HEADER, totalCostPiastres: 1 } }), null)
    check('P7 voided ok', detail({ header: VOIDED_HEADER, lots: voidedLots() }) !== null, true)
    check('P8 voided with an active lot', detail({ header: VOIDED_HEADER }), null)
    check('P9 voided without reason', detail({ header: { ...VOIDED_HEADER, voidReason: null }, lots: voidedLots() }), null)
    check('P10 voided with draftPayload', detail({ header: VOIDED_HEADER, lots: voidedLots(), draftPayload: VALID_DOC }), null)
    check('P11 roll line with piece unit', detail({ lines: [{ ...LINE_ROLL, saleUnit: 'piece' }, LINE_BATCH] }), null)
    check('P12 unknown sale unit', detail({ lines: [{ ...LINE_ROLL, saleUnit: 'box' }, LINE_BATCH] }), null)
    check('P13 batch line with width', detail({ lines: [LINE_ROLL, { ...LINE_BATCH, widthCm: 100 }] }), null)
    check('P14 roll line with quantity', detail({ lines: [{ ...LINE_ROLL, quantity: 1 }, LINE_BATCH] }), null)
    check('P15 roll lot with quantity', detail({ lots: [{ ...LOT_R1, initialQuantity: 1 }, LOT_R2, LOT_B1] }), null)
    check('P16 lot under a missing line', detail({ lots: [LOT_R1, LOT_R2, { ...LOT_B1, lineNo: 9 }] }), null)
    check('P17 lot kind differs from line kind', detail({ lots: [LOT_R1, LOT_R2, { ...LOT_B1, lineNo: 1, lotSequence: 3 }] }), null)
    check('P18 roll count differs from its lots', detail({ lines: [{ ...LINE_ROLL, rollCount: 3 }, LINE_BATCH] }), null)
    check('P19 roll lengths differ from line total length', detail({ lots: [LOT_R1, { ...LOT_R2, initialLengthCm: 2700 }, LOT_B1] }), null)
    check('P20 batch lot sequence must be 1', detail({ lots: [LOT_R1, LOT_R2, { ...LOT_B1, lotSequence: 2 }] }), null)
    check('P21 lot code shape', detail({ lots: [{ ...LOT_R1, lotCode: 'X-1' }, LOT_R2, LOT_B1] }), null)
    check('P22 duplicate line numbers', detail({ lines: [LINE_ROLL, { ...LINE_BATCH, lineNo: 1 }] }), null)
    check('P23 lot product differs from line product', detail({ lots: [LOT_R1, LOT_R2, { ...LOT_B1, productId: 1 }] }), null)
    check('P24 roll lot width differs from line width', detail({ lots: [LOT_R1, { ...LOT_R2, widthCm: 100 }, LOT_B1] }), null)
    check('P25 batch quantity differs from its lot', detail({ lots: [LOT_R1, LOT_R2, { ...LOT_B1, initialQuantity: 9 }] }), null)

    const draftDetail = (h: Record<string, unknown>, patch: Record<string, unknown> = {}) =>
      parsePurchaseDetail({ header: h, draftPayload: VALID_DOC, lines: [], charges: [], lots: [], ...patch })
    check('P26 draft ok', draftDetail(header('draft', { lineCount: 2, chargeCount: 1 })) !== null, true)
    check('P27 draft with child rows', draftDetail(header('draft', { lineCount: 2, chargeCount: 1 }), { lines: [LINE_ROLL] }), null)
    check('P28 draft counts differ from payload', draftDetail(header('draft')), null)
    check('P29 draft with lot count', draftDetail(header('draft', { lineCount: 2, chargeCount: 1, lotCount: 1 })), null)
    check('P30 draft with postedAt', draftDetail(header('draft', { lineCount: 2, chargeCount: 1, postedAt: '2026-10-07T10:00:00Z' })), null)
    check('P31 discarded ok', draftDetail(DISCARDED_HEADER) !== null, true)
    check('P32 discarded without payload', draftDetail(DISCARDED_HEADER, { draftPayload: null }), null)
    check('P33 discarded with lots', draftDetail(DISCARDED_HEADER, { lots: [LOT_B1] }), null)
    check('P34 discarded without discardedAt', draftDetail({ ...DISCARDED_HEADER, discardedAt: null }), null)
  }

  return { passed, failures }
}
