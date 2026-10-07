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

function header(status: string): Record<string, unknown> {
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
  }
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
    parsePurchaseDetail({ header: header('draft'), draftPayload: VALID_DOC, lines: [], charges: [], lots: [] })?.draftPayload,
    VALID_DOC,
  )
  check('G5 draft without payload rejected', parsePurchaseDetail({ header: header('draft'), draftPayload: null, lines: [], charges: [], lots: [] }), null)
  check('G6 posted detail with no payload ok', parsePurchaseDetail({ header: header('posted'), draftPayload: null, lines: [], charges: [], lots: [] }) !== null, true)
  check(
    'G7 detail with invalid payload rejected',
    parsePurchaseDetail({ header: header('draft'), draftPayload: { ...VALID_DOC, extra: 1 }, lines: [], charges: [], lots: [] }),
    null,
  )
  check(
    'G8 posted lot shape',
    parsePurchaseDetail({
      header: header('posted'),
      draftPayload: null,
      lines: [],
      charges: [{ chargeNo: 1, kind: 'customs', amountPiastres: 5, reference: null, note: null }],
      lots: [
        {
          lotId: 1, lotCode: 'R-000001', sourceKind: 'purchase', lotKind: 'roll', lotSequence: 1, lineNo: 1, productId: 1, locationId: 1,
          widthCm: 152, initialLengthCm: 3000, initialQuantity: null, baseCostPiastres: 100, allocatedExtrasPiastres: 0,
          allocatedDiscountPiastres: 0, landedCostPiastres: 100, costIsEstimated: false, receivedOn: '2026-10-06', status: 'active', voidedAt: null,
        },
      ],
    }) !== null,
    true,
  )
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

  return { passed, failures }
}
