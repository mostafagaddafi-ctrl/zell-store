/**
 * حالات تكرار فاتورة الشراء — منطق خالص.
 * بتتشغّل بـ: pnpm --filter @zell/admin cases  (suite = duplicate)
 *   • مفيش نسخ لأي معرف أو حالة أو بيانات ترحيل/إبطال، والتاريخ النهارده، ورقم فاتورة المورد فاضي.
 *   • الأصل مابيتغيّرش (متجمّد ومقارن قبل وبعد).
 *   • النموذج الناتج بيعدّي على نفس التحقق (buildPurchasePayload ← validatePurchaseDoc) اللي الحفظ والمعاينة بيستخدموه،
 *     والـ payload الناتج = بيانات الأصل بالظبط.
 *   • مورد / مخزن موقوف = بيفضى ويتطلب بديل · منتج موقوف / وحدة / عرض اتغيّر = مانع حفظ.
 */

import type { CatalogProduct } from './catalog'
import {
  buildDuplicateSeed,
  duplicateFormBlockers,
  duplicatePayload,
  duplicateToForm,
  type DuplicateContext,
} from './purchaseDuplicate'
import { buildPurchasePayload, validatePurchaseDoc, type PurchaseDocPayload } from './purchaseForm'
import type { PurchaseDetail, PurchaseHeader } from './purchases'

export type DuplicateCaseFailure = { name: string; expected: string; actual: string }
export type DuplicateCasesReport = { passed: number; failures: DuplicateCaseFailure[] }

const TODAY = '2026-10-09'

function product(id: number, nameAr: string, saleUnit: 'meter' | 'piece', widths: number[], isActive = true): CatalogProduct {
  return {
    id,
    nameAr,
    saleUnit,
    isActive,
    baseWidthCm: saleUnit === 'meter' ? (widths[0] ?? null) : null,
    basePricePiastres: 10000,
    allowedWidthsCm: widths,
    widthOptions: [],
  }
}

function catalogOf(products: CatalogProduct[]): Map<number, CatalogProduct> {
  return new Map(products.map((p) => [p.id, p]))
}

const BASE_CATALOG = [product(1, 'عازل حرارة', 'meter', [100, 120]), product(2, 'مقبض', 'piece', [])]

function context(overrides: Partial<DuplicateContext> = {}): DuplicateContext {
  return {
    catalog: overrides.catalog ?? catalogOf(BASE_CATALOG),
    activeSupplierIds: overrides.activeSupplierIds ?? new Set([7, 8]),
    activeLocationIds: overrides.activeLocationIds ?? new Set([1]),
  }
}

function header(overrides: Partial<PurchaseHeader> = {}): PurchaseHeader {
  return {
    docId: 55,
    docNo: 'PUR-000055',
    status: 'posted',
    supplierId: 7,
    supplierName: 'مورد أ',
    supplierRef: 'INV-9',
    locationId: 1,
    locationName: 'المخزن الرئيسي',
    docDate: '2026-09-01',
    note: 'شحنة سبتمبر',
    supplierDiscountPiastres: 500,
    itemsSubtotalPiastres: 70000,
    extrasTotalPiastres: 2000,
    totalCostPiastres: 71500,
    lineCount: 2,
    chargeCount: 1,
    lotCount: 3,
    postedAt: '2026-09-01T10:00:00Z',
    voidedAt: null,
    voidReason: null,
    discardedAt: null,
    discardReason: null,
    version: 3,
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

function postedDetail(overrides: Partial<PurchaseHeader> = {}): PurchaseDetail {
  return {
    header: header(overrides),
    draftPayload: null,
    lines: [
      {
        lineId: 901, lineNo: 1, kind: 'roll', productId: 1, productName: 'عازل حرارة', saleUnit: 'meter', widthCm: 120,
        rollCount: 2, totalLengthCm: 6050, quantity: null, lineTotalPiastres: 60000, zeroCostReason: null,
        allocatedExtrasPiastres: 1700, allocatedDiscountPiastres: 430, landedTotalPiastres: 61270,
      },
      {
        lineId: 902, lineNo: 2, kind: 'batch', productId: 2, productName: 'مقبض', saleUnit: 'piece', widthCm: null,
        rollCount: null, totalLengthCm: null, quantity: 4, lineTotalPiastres: 10000, zeroCostReason: null,
        allocatedExtrasPiastres: 300, allocatedDiscountPiastres: 70, landedTotalPiastres: 10230,
      },
    ],
    charges: [{ chargeNo: 1, kind: 'transport', amountPiastres: 2000, reference: 'RCPT-1', note: 'نقل من المصنع' }],
    lots: [
      { lotId: 7002, lotCode: 'R-000002', lotKind: 'roll', lotSequence: 2, lineNo: 1, productId: 1, widthCm: 120, initialLengthCm: 3000, initialQuantity: null, baseCostPiastres: 29752, allocatedExtrasPiastres: 843, allocatedDiscountPiastres: 213, landedCostPiastres: 30382, receivedOn: '2026-09-01', status: 'active' },
      { lotId: 7001, lotCode: 'R-000001', lotKind: 'roll', lotSequence: 1, lineNo: 1, productId: 1, widthCm: 120, initialLengthCm: 3050, initialQuantity: null, baseCostPiastres: 30248, allocatedExtrasPiastres: 857, allocatedDiscountPiastres: 217, landedCostPiastres: 30888, receivedOn: '2026-09-01', status: 'active' },
      { lotId: 7003, lotCode: 'B-000001', lotKind: 'batch', lotSequence: 1, lineNo: 2, productId: 2, widthCm: null, initialLengthCm: null, initialQuantity: 4, baseCostPiastres: 10000, allocatedExtrasPiastres: 300, allocatedDiscountPiastres: 70, landedCostPiastres: 10230, receivedOn: '2026-09-01', status: 'active' },
    ],
  }
}

function draftDetail(status: 'draft' | 'discarded'): PurchaseDetail {
  const payload: PurchaseDocPayload = {
    supplierId: 8,
    supplierRef: 'X-1',
    locationId: 1,
    docDate: '2026-09-20',
    note: null,
    charges: [{ kind: 'loading', amountPiastres: 1500, reference: 'R-77', note: null }],
    supplierDiscountPiastres: 0,
    lines: [{ kind: 'batch', productId: 2, quantity: 10, lineTotalPiastres: 25000, zeroCostReason: null }],
  }
  return {
    header: header({ status, docId: 60, docNo: 'PUR-000060', supplierId: 8, supplierName: 'مورد ب', postedAt: null, lotCount: 0, discardedAt: status === 'discarded' ? '2026-09-21T00:00:00Z' : null, discardReason: status === 'discarded' ? 'تجربة' : null }),
    draftPayload: payload,
    lines: [],
    charges: [],
    lots: [],
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}

function keyMaker(): () => string {
  let n = 0
  return () => {
    n += 1
    return 'k' + String(n)
  }
}

export function runDuplicateCases(): DuplicateCasesReport {
  const failures: DuplicateCaseFailure[] = []
  let passed = 0
  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed += 1
    else failures.push({ name, expected: e, actual: a })
  }

  // ── مرحّل: النسخ والمعرفات ──
  const source = deepFreeze(postedDetail())
  const before = JSON.stringify(source)
  const { payload, problems } = duplicatePayload(source, TODAY)
  check('original unchanged (posted)', JSON.stringify(source), before)
  check('payload keys only (no ids, status, version, dates)', Object.keys(payload).sort(), ['charges', 'docDate', 'lines', 'locationId', 'note', 'supplierDiscountPiastres', 'supplierId', 'supplierRef'])
  check('date = today', payload.docDate, TODAY)
  check('supplier ref not copied', payload.supplierRef, null)
  check('supplier + location + note + discount copied', [payload.supplierId, payload.locationId, payload.note, payload.supplierDiscountPiastres], [7, 1, 'شحنة سبتمبر', 500])
  check('lines from posted lines in order; roll lengths from lots by sequence', payload.lines, [
    { kind: 'roll', productId: 1, widthCm: 120, rolls: [{ lengthCm: 3050 }, { lengthCm: 3000 }], lineTotalPiastres: 60000, zeroCostReason: null },
    { kind: 'batch', productId: 2, quantity: 4, lineTotalPiastres: 10000, zeroCostReason: null },
  ])
  check('charges copied without reference', payload.charges, [{ kind: 'transport', amountPiastres: 2000, reference: null, note: 'نقل من المصنع' }])
  check('no problems', problems, [])
  const text = JSON.stringify(payload)
  const leaked = ['PUR-000055', 'R-000001', 'R-000002', 'B-000001', 'INV-9', 'RCPT-1', '2026-09-01', 'posted', 'lotId', 'lineId', 'docId', 'version', 'postedAt', 'allocated', 'landed']
    .filter((needle) => text.includes(needle))
  check('no identifiers / status / posting data in payload', leaked, [])

  // ── النموذج بيعدّي على نفس التحقق، والناتج = الأصل ──
  const seed = buildDuplicateSeed(source, TODAY, context())
  check('original unchanged (seed)', JSON.stringify(source), before)
  check('seed: nothing cleared, no notes', [seed.supplierCleared, seed.locationCleared, seed.notes], [false, false, []])
  check('seed source', [seed.sourceDocId, seed.sourceDocNo], [55, 'PUR-000055'])
  const form = duplicateToForm(seed, keyMaker())
  check('form supplierRef empty', form.supplierRef, '')
  check('form date today', form.docDate, TODAY)
  const built = buildPurchasePayload(form, context().catalog, TODAY)
  check('form passes the same validation as save / preview', built.ok, true)
  if (built.ok) {
    check('built payload = duplicated payload', built.value, payload)
    const revalidated = validatePurchaseDoc(built.value)
    check('validatePurchaseDoc accepts it (server-side rules)', revalidated.ok, true)
  }
  check('no blockers', duplicateFormBlockers(form, { ...context(), supplierRequired: false }), [])

  // ── مسودة ومستبعَد: من draftPayload ──
  for (const status of ['draft', 'discarded'] as const) {
    const d = deepFreeze(draftDetail(status))
    const b = JSON.stringify(d)
    const r = duplicatePayload(d, TODAY)
    check(status + ': original unchanged', JSON.stringify(d), b)
    check(status + ': payload', r.payload, {
      supplierId: 8,
      supplierRef: null,
      locationId: 1,
      docDate: TODAY,
      note: null,
      charges: [{ kind: 'loading', amountPiastres: 1500, reference: null, note: null }],
      supplierDiscountPiastres: 0,
      lines: [{ kind: 'batch', productId: 2, quantity: 10, lineTotalPiastres: 25000, zeroCostReason: null }],
    })
    const f = duplicateToForm(buildDuplicateSeed(d, TODAY, context()), keyMaker())
    const ok = buildPurchasePayload(f, context().catalog, TODAY)
    check(status + ': passes validation', ok.ok, true)
  }

  // ── مورد / مخزن موقوف ──
  const s2 = buildDuplicateSeed(postedDetail(), TODAY, context({ activeSupplierIds: new Set([8]) }))
  check('inactive supplier cleared', s2.supplierCleared, true)
  check('inactive supplier note', s2.notes.length, 1)
  const f2 = duplicateToForm(s2, keyMaker())
  check('form supplier empty', f2.supplierId, '')
  const ctx2 = { ...context({ activeSupplierIds: new Set([8]) }), supplierRequired: s2.supplierCleared }
  check('blocked until an active supplier is chosen', duplicateFormBlockers(f2, ctx2).length, 1)
  check('active supplier chosen -> unblocked', duplicateFormBlockers({ ...f2, supplierId: '8' }, ctx2), [])
  check('choosing an inactive id is blocked', duplicateFormBlockers({ ...f2, supplierId: '7' }, ctx2), ['المورد المختار مش نشط.'])
  const s3 = buildDuplicateSeed(postedDetail(), TODAY, context({ activeLocationIds: new Set([2]) }))
  check('inactive location cleared', s3.locationCleared, true)
  const f3 = duplicateToForm(s3, keyMaker())
  check('form location empty', f3.locationId, '')
  const b3 = buildPurchasePayload(f3, context().catalog, TODAY)
  check('save blocked by normal validation until a location is chosen', b3.ok ? 'ok' : b3.message, 'اختار المخزن.')

  // ── منتج موقوف / وحدة / عرض اتغيّر ──
  const inactiveCatalog = catalogOf([product(1, 'عازل حرارة', 'meter', [100, 120], false), product(2, 'مقبض', 'piece', [])])
  const s4 = buildDuplicateSeed(postedDetail(), TODAY, context({ catalog: inactiveCatalog }))
  check('inactive product noted', s4.notes.length, 1)
  const f4 = duplicateToForm(s4, keyMaker())
  check('inactive product blocks save', duplicateFormBlockers(f4, { ...context({ catalog: inactiveCatalog }), supplierRequired: false }), ['بند 1: المنتج «عازل حرارة» موقوف.'])
  const unitCatalog = catalogOf([product(1, 'عازل حرارة', 'piece', []), product(2, 'مقبض', 'piece', [])])
  const f5 = duplicateToForm(buildDuplicateSeed(postedDetail(), TODAY, context({ catalog: unitCatalog })), keyMaker())
  check('sale unit changed blocks save', duplicateFormBlockers(f5, { ...context({ catalog: unitCatalog }), supplierRequired: false }).length, 1)
  check('sale unit changed also fails normal validation', buildPurchasePayload(f5, unitCatalog, TODAY).ok, false)
  const widthCatalog = catalogOf([product(1, 'عازل حرارة', 'meter', [100]), product(2, 'مقبض', 'piece', [])])
  const f6 = duplicateToForm(buildDuplicateSeed(postedDetail(), TODAY, context({ catalog: widthCatalog })), keyMaker())
  check('width removed blocks save', duplicateFormBlockers(f6, { ...context({ catalog: widthCatalog }), supplierRequired: false }), ['بند 1: العرض 120 سم مابقاش من عروض «عازل حرارة».'])
  check('product missing from catalog', duplicateFormBlockers(f6, { ...context({ catalog: catalogOf([product(2, 'مقبض', 'piece', [])]) }), supplierRequired: false }), ['بند 1: المنتج #1 مش موجود في الكتالوج.'])

  // ── أصل ناقص (لفّات) ──
  const broken = postedDetail()
  const r7 = duplicatePayload({ ...broken, lots: broken.lots.filter((lot) => lot.lotId !== 7002) }, TODAY)
  check('missing roll lots reported', r7.problems.length, 1)

  return { passed, failures }
}
