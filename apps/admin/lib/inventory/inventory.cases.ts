/**
 * حالات اختبار PR-A (0020-UI) — منطق خالص بس، من غير أي نداء داتابيز ولا شبكة.
 *
 * بتتشغّل فعليًا بـ: pnpm --filter @zell/admin cases  (apps/admin/scripts/run-cases.mjs)
 * runInventoryCases() بترجّع عدد الناجح وقايمة الفاشل (فاضية = كله تمام).
 *
 * ⚠️ الملف ده مابيستوردش أي حاجة server-only، ومحدش بيستورده فمابيدخلش في الـbundle.
 */

import {
  CATALOG_INCOMPLETE_MESSAGE,
  allowedWidths,
  assessCompleteness,
  buildCatalog,
  catalogBlocksDocuments,
  combineCompleteness,
  type CatalogProductRow,
} from './catalog'
import {
  COMMAND_ID_MESSAGE,
  INVENTORY_ERRORS,
  INVENTORY_OWNER_ONLY_MESSAGE,
  INVENTORY_UNRESOLVED_MESSAGE,
  failureFromSentinel,
  rejectedFailure,
  validationFailure,
} from './errors'
import { isUuid, parseDbId, parseVersion } from './ids'
import {
  LEAVE_WARNING,
  NETWORK_UNRESOLVED_MESSAGE,
  abandonIntent,
  beginIntent,
  canEditPayload,
  editIntent,
  initialIntent,
  isLeaveRisky,
  retryIntent,
  settleIntent,
  type IntentState,
} from './intent'
import { DOC_STATUS_LABELS, FORBIDDEN_WORDS, LOT_STATUS_LABELS, allInventoryLabels } from './labels'
import { INVENTORY_SENTINELS, INVENTORY_SQLSTATE, isInventorySentinel, type InventorySentinel } from './sentinels'
import {
  PHONE_LATIN_DIGITS_MESSAGE,
  SUPPLIER_NAME_MAX,
  isSupplierWriteResult,
  isSuppliersPage,
  normalizeSupplierInput,
  normalizeSupplierUpdate,
  parseSupplierCursor,
  supplierToForm,
} from './suppliers'

export type InventoryCaseFailure = { name: string; expected: string; actual: string }
export type InventoryCasesReport = { passed: number; failures: InventoryCaseFailure[] }

/** أسماء client.ts الموجودة قبل 0020 — للتأكد إن مفيش تداخل في المطابقة (تامة أو بادئة «CODE:»). */
const LEGACY_SENTINELS = [
  'ZELL_INVALID_ORDER',
  'ZELL_INVALID_SHIPPING',
  'ZELL_INVALID_IDENTITY',
  'ZELL_INVALID_COLLECTION',
  'ZELL_INVALID_COLLECTION_PRODUCTS',
  'ZELL_COLLECTION_SLUG_TAKEN',
  'ZELL_ORDER_CANCELLED_FINAL',
] as const

/** التصنيف المعتمد في المراجعة (ملحق v2 · البند 8) — مكتوب صريح هنا ومقارن بالجدول. */
const EXPECTED_CATEGORY: Record<InventorySentinel, string> = {
  ZELL_INV_FORBIDDEN: 'FORBIDDEN',
  ZELL_INV_NOT_FOUND: 'NOT_FOUND',
  ZELL_INV_CONFLICT: 'CONFLICT',
  ZELL_INV_INVALID: 'VALIDATION',
  ZELL_INV_SUPPLIER_INACTIVE: 'VALIDATION',
  ZELL_INV_LOCATION_INACTIVE: 'VALIDATION',
  ZELL_INV_PRODUCT_UNIT: 'VALIDATION',
  ZELL_INV_WIDTH_NOT_ALLOWED: 'VALIDATION',
  ZELL_INV_NOT_DRAFT: 'CONFLICT',
  ZELL_INV_EMPTY: 'VALIDATION',
  ZELL_INV_ALLOCATION_BASE_ZERO: 'VALIDATION',
  ZELL_INV_DISCOUNT_TOO_LARGE: 'VALIDATION',
  ZELL_INV_COMMAND_MISMATCH: 'CONFLICT',
  ZELL_INV_HAS_DEPENDENCIES: 'CONFLICT',
  ZELL_INV_NOT_POSTED: 'CONFLICT',
  ZELL_INV_ZERO_COST_RULE: 'VALIDATION',
  ZELL_INV_IMMUTABLE: 'CONFLICT',
  ZELL_INV_SALE_UNIT_LOCKED: 'CONFLICT',
  ZELL_INV_SUPPLIER_NAME_TAKEN: 'VALIDATION',
  ZELL_INV_LOCATION_CODE_TAKEN: 'VALIDATION',
  ZELL_INV_MAIN_LOCKED: 'VALIDATION',
  ZELL_INV_DATE_IN_FUTURE: 'VALIDATION',
  ZELL_INV_COMMAND_RACE: 'CONFLICT',
}

const ID_A = '6f1c2a4e-3b5d-4c7e-9f10-1a2b3c4d5e6f'
const ID_B = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b'

type P = { name: string }

export function runInventoryCases(): InventoryCasesReport {
  const failures: InventoryCaseFailure[] = []
  let passed = 0

  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed += 1
    else failures.push({ name, expected: e, actual: a })
  }

  // ── A. اكتمال الـsentinels ──────────────────────────────────
  check('A1 sentinels count = 23', INVENTORY_SENTINELS.length, 23)
  check('A2 sentinels unique', new Set(INVENTORY_SENTINELS).size, 23)
  check(
    'A3 sentinel shape',
    INVENTORY_SENTINELS.filter((s) => !/^ZELL_INV_[A-Z_]+$/.test(s)),
    [],
  )
  check(
    'A4 SQLSTATE contiguous 45200..45222 in order',
    INVENTORY_SENTINELS.map((s) => INVENTORY_SQLSTATE[s]),
    INVENTORY_SENTINELS.map((_s, i) => String(45200 + i)),
  )
  check('A5 SQLSTATE map has exactly 23 keys', Object.keys(INVENTORY_SQLSTATE).length, 23)
  {
    const all: string[] = [...LEGACY_SENTINELS, ...INVENTORY_SENTINELS]
    check('A6a no duplicate across legacy + inventory', new Set(all).size, all.length)
    const clashes: string[] = []
    for (const a of all) for (const b of all) if (a !== b && a.startsWith(b + ':')) clashes.push(a + '|' + b)
    check('A6b no CODE: prefix clash', clashes, [])
    check('A7 legacy names are not inventory names', LEGACY_SENTINELS.filter((s) => isInventorySentinel(s)), [])
  }
  check('A8 isInventorySentinel accepts known', isInventorySentinel('ZELL_INV_COMMAND_RACE'), true)
  check('A9 isInventorySentinel rejects unknown', isInventorySentinel('ZELL_INV_SOMETHING'), false)
  check('A10 isInventorySentinel rejects non-string', isInventorySentinel(45200), false)

  // ── B. جدول الأخطاء ─────────────────────────────────────────
  check('B1 error table has 23 entries', Object.keys(INVENTORY_ERRORS).length, 23)
  check(
    'B2 categories match the approved table',
    INVENTORY_SENTINELS.filter((s) => INVENTORY_ERRORS[s].category !== EXPECTED_CATEGORY[s]),
    [],
  )
  check(
    'B3 resolution: 45212 hard, 45222 unresolved, the rest rejected',
    INVENTORY_SENTINELS.filter((s) => {
      const expected = s === 'ZELL_INV_COMMAND_MISMATCH' ? 'hard' : s === 'ZELL_INV_COMMAND_RACE' ? 'unresolved' : 'rejected'
      return INVENTORY_ERRORS[s].resolution !== expected
    }),
    [],
  )
  check(
    'B4 every message non-empty',
    INVENTORY_SENTINELS.filter((s) => INVENTORY_ERRORS[s].message.trim() === ''),
    [],
  )
  check('B5 unknown failure → INTERNAL unresolved', failureFromSentinel(null), {
    ok: false,
    code: 'INTERNAL',
    message: INVENTORY_UNRESOLVED_MESSAGE,
    resolution: 'unresolved',
  })
  check('B6 45202 → CONFLICT rejected', failureFromSentinel('ZELL_INV_CONFLICT').resolution, 'rejected')
  check('B7 45212 → CONFLICT hard', failureFromSentinel('ZELL_INV_COMMAND_MISMATCH'), {
    ok: false,
    code: 'CONFLICT',
    message: INVENTORY_ERRORS.ZELL_INV_COMMAND_MISMATCH.message,
    resolution: 'hard',
  })
  check('B8 45217 → CONFLICT', failureFromSentinel('ZELL_INV_SALE_UNIT_LOCKED').code, 'CONFLICT')
  check('B9 45203 generic message (no details)', failureFromSentinel('ZELL_INV_INVALID').message, 'في بيانات غير صالحة. راجع الحقول.')
  check('B10 guard failure is rejected', rejectedFailure({ code: 'DISABLED', message: 'x' }).resolution, 'rejected')
  check('B11 validation failure', validationFailure('m'), { ok: false, code: 'VALIDATION', message: 'm', resolution: 'rejected' })

  // ── C. state machine للنية ──────────────────────────────────
  {
    const s0 = initialIntent<P>()
    check('C1 initial is editing', s0, { phase: 'editing', failure: null })
    check('C2 can edit initially', canEditPayload(s0), true)
    check('C3 begin with non-uuid refused', beginIntent(s0, { name: 'x' }, 'not-a-uuid'), null)

    const s1 = beginIntent(s0, { name: 'x' }, ID_A)
    check('C4 begin → submitting', s1, { phase: 'submitting', commandId: ID_A, payload: { name: 'x' }, attempt: 1 })
    if (s1 !== null) {
      check('C5 payload locked while submitting', canEditPayload(s1), false)
      check('C6 leave risky while submitting', isLeaveRisky(s1), true)
      check('C7 second begin while submitting refused', beginIntent(s1, { name: 'y' }, ID_B), null)
      check('C8 edit ignored while submitting', editIntent(s1), s1)
      check('C9 settle with other id ignored', settleIntent(s1, ID_B, { ok: true }), s1)
      check('C10 success → done', settleIntent(s1, ID_A, { ok: true }), { phase: 'done', commandId: ID_A })

      const rejected = settleIntent(s1, ID_A, {
        ok: false,
        code: 'VALIDATION',
        message: 'اسم المورد ده موجود قبل كده.',
        resolution: 'rejected',
      })
      check('C11 rejected → editing with failure', rejected, {
        phase: 'editing',
        failure: { code: 'VALIDATION', message: 'اسم المورد ده موجود قبل كده.' },
      })
      check('C12 can edit after rejection', canEditPayload(rejected), true)
      check('C13 edit clears failure', editIntent(rejected), { phase: 'editing', failure: null })
      const again = beginIntent(rejected, { name: 'z' }, ID_B)
      check('C14 new intent after rejection uses the new id', again !== null && again.phase === 'submitting' ? again.commandId : null, ID_B)

      const unresolved = settleIntent(s1, ID_A, {
        ok: false,
        code: 'INTERNAL',
        message: INVENTORY_UNRESOLVED_MESSAGE,
        resolution: 'unresolved',
      })
      check('C15 INTERNAL → unresolved (soft)', unresolved, {
        phase: 'unresolved',
        commandId: ID_A,
        payload: { name: 'x' },
        attempt: 1,
        hard: false,
        message: INVENTORY_UNRESOLVED_MESSAGE,
      })
      check('C16 payload locked while unresolved', canEditPayload(unresolved), false)
      check('C17 leave risky while unresolved', isLeaveRisky(unresolved), true)
      check('C18 begin refused while unresolved', beginIntent(unresolved, { name: 'y' }, ID_B), null)
      check('C19 retry keeps same id and payload', retryIntent(unresolved), {
        phase: 'submitting',
        commandId: ID_A,
        payload: { name: 'x' },
        attempt: 2,
      })
      check('C20 abandon → abandoned', abandonIntent(unresolved), { phase: 'abandoned' })
      const abandoned: IntentState<P> = { phase: 'abandoned' }
      check('C21 abandoned does not reopen payload', canEditPayload(abandoned), false)
      check('C22 begin refused after abandon', beginIntent(abandoned, { name: 'y' }, ID_B), null)

      const thrown = settleIntent(s1, ID_A, { thrown: true })
      check('C23 thrown (network) → unresolved soft', thrown.phase === 'unresolved' ? [thrown.hard, thrown.message] : null, [
        false,
        NETWORK_UNRESOLVED_MESSAGE,
      ])

      const race = settleIntent(s1, ID_A, failureFromSentinel('ZELL_INV_COMMAND_RACE'))
      check('C24 45222 → unresolved soft (retry same id)', race.phase === 'unresolved' ? race.hard : null, false)

      const hard = settleIntent(s1, ID_A, failureFromSentinel('ZELL_INV_COMMAND_MISMATCH'))
      check('C25 45212 → unresolved hard', hard.phase === 'unresolved' ? hard.hard : null, true)
      check('C26 retry refused on hard', retryIntent(hard), null)
      check('C27 begin refused on hard', beginIntent(hard, { name: 'y' }, ID_B), null)
      check('C28 abandon allowed on hard (reconcile)', abandonIntent(hard), { phase: 'abandoned' })
    }
    check('C29 retry refused from editing', retryIntent(s0), null)
    check('C30 abandon refused from editing', abandonIntent(s0), null)
    check('C31 done not risky', isLeaveRisky({ phase: 'done', commandId: ID_A }), false)
    check('C32 leave warning mentions same key', LEAVE_WARNING.includes('نفس المفتاح'), true)
  }

  // ── D. الموردين ─────────────────────────────────────────────
  check('D1 valid supplier', normalizeSupplierInput({ name: '  مؤسسة النور  ', phone: '0100 123-4567', note: '' }), {
    ok: true,
    value: { name: 'مؤسسة النور', phone: '01001234567', note: null },
  })
  check('D2 empty name', normalizeSupplierInput({ name: ' \t ', phone: null, note: null }).ok, false)
  check('D3 missing name', normalizeSupplierInput({ phone: null, note: null }).ok, false)
  check('D4 name 120 code points ok', normalizeSupplierInput({ name: 'م'.repeat(SUPPLIER_NAME_MAX), phone: null, note: null }).ok, true)
  check('D5 name 121 rejected', normalizeSupplierInput({ name: 'م'.repeat(121), phone: null, note: null }).ok, false)
  check(
    'D6 name length counts code points (emoji)',
    normalizeSupplierInput({ name: '😀'.repeat(120), phone: null, note: null }).ok,
    true,
  )
  // D7: الأرقام العربية/الفارسية بتترفض زي الداتابيز بالظبط — مفيش تحويل صامت
  check('D7 arabic digits rejected (no silent conversion)', normalizeSupplierInput({ name: 'أ', phone: '٠١٠٠١٢٣٤٥٦٧', note: null }), {
    ok: false,
    message: PHONE_LATIN_DIGITS_MESSAGE,
  })
  check('D7b persian digits rejected', normalizeSupplierInput({ name: 'أ', phone: '۰۱۰۰۱۲۳۴۵۶۷', note: null }).ok, false)
  check('D7c mixed arabic + latin digits rejected', normalizeSupplierInput({ name: 'أ', phone: '0100١٢٣4567', note: null }).ok, false)
  check('D8 +country ok', normalizeSupplierInput({ name: 'أ', phone: '+201001234567', note: null }).ok, true)
  check('D9 phone 5 digits rejected', normalizeSupplierInput({ name: 'أ', phone: '12345', note: null }).ok, false)
  check('D10 phone 16 digits rejected', normalizeSupplierInput({ name: 'أ', phone: '1234567890123456', note: null }).ok, false)
  check('D11 phone letters rejected', normalizeSupplierInput({ name: 'أ', phone: '0100abc4567', note: null }).ok, false)
  check('D12 blank phone → null', normalizeSupplierInput({ name: 'أ', phone: '  ', note: null }), {
    ok: true,
    value: { name: 'أ', phone: null, note: null },
  })
  check('D13 note 500 ok', normalizeSupplierInput({ name: 'أ', phone: null, note: 'ن'.repeat(500) }).ok, true)
  check('D14 note 501 rejected', normalizeSupplierInput({ name: 'أ', phone: null, note: 'ن'.repeat(501) }).ok, false)
  check(
    'D15 NFC normalization',
    normalizeSupplierInput({ name: 'Cafe\u0301', phone: null, note: null }),
    { ok: true, value: { name: 'Caf\u00e9', phone: null, note: null } },
  )
  check('D16 not an object', normalizeSupplierInput(null).ok, false)
  check('D17 array rejected', normalizeSupplierInput([]).ok, false)
  check('D18 phone wrong type', normalizeSupplierInput({ name: 'أ', phone: 5, note: null }).ok, false)
  check('D19 update needs boolean isActive', normalizeSupplierUpdate({ name: 'أ', phone: null, note: null }).ok, false)
  check('D20 update ok', normalizeSupplierUpdate({ name: 'أ', phone: null, note: null, isActive: false }), {
    ok: true,
    value: { name: 'أ', phone: null, note: null, isActive: false },
  })
  check('D21 cursor string kept', parseSupplierCursor('مؤسسة'), 'مؤسسة')
  check('D22 cursor empty → null', parseSupplierCursor(''), null)
  check('D23 cursor array → null', parseSupplierCursor(['a']), null)
  check(
    'D24 supplierToForm',
    supplierToForm({ supplierId: 1, name: 'أ', phone: null, note: null, isActive: true, version: 1, updatedAt: 'x' }),
    { name: 'أ', phone: '', note: '', isActive: true },
  )
  check(
    'D25 suppliers page shape ok',
    isSuppliersPage({
      items: [{ supplierId: 3, name: 'أ', phone: null, note: 'ن', isActive: true, version: 2, updatedAt: '2026-10-07T00:00:00Z' }],
      nextAfterNameKey: null,
    }),
    true,
  )
  check('D26 suppliers page missing items', isSuppliersPage({ nextAfterNameKey: null }), false)
  check(
    'D27 suppliers page bad row',
    isSuppliersPage({ items: [{ supplierId: '3', name: 'أ' }], nextAfterNameKey: null }),
    false,
  )
  check('D28 write result ok', isSupplierWriteResult({ supplierId: 4, version: 1 }), true)
  check('D29 write result replay ok', isSupplierWriteResult({ supplierId: 4, version: 1, replayed: true }), true)
  check('D30 write result bad', isSupplierWriteResult({ supplierId: 0, version: 1 }), false)

  // ── E. المعرّفات ────────────────────────────────────────────
  check('E1 uuid ok', isUuid(ID_A), true)
  check('E2 uuid uppercase ok', isUuid(ID_A.toUpperCase()), true)
  check('E3 uuid bad', isUuid('6f1c2a4e-3b5d-4c7e-9f10'), false)
  check('E4 uuid non-string', isUuid(12), false)
  check('E5 id ok', parseDbId(7), 7)
  check('E6 id zero', parseDbId(0), null)
  check('E7 id fraction', parseDbId(1.5), null)
  check('E8 id string', parseDbId('7'), null)
  check('E9 version ok', parseVersion(1), 1)
  check('E10 version zero', parseVersion(0), null)
  check('E11 version too big', parseVersion(2147483648), null)

  // ── F. الكتالوج ─────────────────────────────────────────────
  check('F1 complete', assessCompleteness(7, 7), 'complete')
  check('F2 empty complete', assessCompleteness(0, 0), 'complete')
  check('F3 null total uncertain', assessCompleteness(7, null), 'uncertain')
  check('F4 truncated incomplete', assessCompleteness(500, 612), 'incomplete')
  check('F5 more rows than total uncertain', assessCompleteness(3, 2), 'uncertain')
  check('F6 combine worst', combineCompleteness('complete', 'incomplete'), 'incomplete')
  check('F7 combine uncertain', combineCompleteness('uncertain', 'complete'), 'uncertain')
  check('F8 widths base + active, dedup, sorted', allowedWidths(100, [152, 60, 100]), [60, 100, 152])
  check('F9 widths null base', allowedWidths(null, [50]), [50])
  check('F10 widths base only', allowedWidths(75, []), [75])
  check('F11 widths ignore bad values', allowedWidths(0, [-5, 1.5, 40]), [40])
  {
    const rows: CatalogProductRow[] = [
      { id: 1, name_ar: 'فيلم', sale_unit: 'meter', width_cm: 100, price_per_meter_piastres: 25000, is_active: true, sort_order: 0 },
      { id: 2, name_ar: 'أداة', sale_unit: 'piece', width_cm: null, price_per_meter_piastres: 5000, is_active: false, sort_order: 1 },
    ]
    const catalog = buildCatalog(rows, [{ product_id: 1, width_cm: 152, price_per_meter_piastres: 36000 }], 'complete')
    check('F12 build keeps inactive product', catalog.products.map((p) => [p.id, p.isActive]), [
      [1, true],
      [2, false],
    ])
    check('F13 build allowed widths per product', catalog.products.map((p) => p.allowedWidthsCm), [[100, 152], []])
    check('F14 build complete status', catalog.status, 'complete')
    check('F15 complete does not block documents', catalogBlocksDocuments(catalog), false)
    const odd = buildCatalog([...rows, { id: 3, name_ar: 'غريب', sale_unit: 'box', width_cm: null, price_per_meter_piastres: 1, is_active: true, sort_order: 2 }], [], 'complete')
    check('F16 unknown unit skipped + uncertain', [odd.products.length, odd.skippedProducts, odd.status], [2, 1, 'uncertain'])
    check('F17 uncertain blocks documents', catalogBlocksDocuments(odd), true)
    check('F18 incomplete blocks documents', catalogBlocksDocuments(buildCatalog(rows, [], 'incomplete')), true)
  }

  // ── G. المصطلحات والكلمات الممنوعة ───────────────────────────
  check('G1 discarded label', DOC_STATUS_LABELS.discarded, 'مستبعَد (مسودة)')
  check('G2 voided label', DOC_STATUS_LABELS.voided, 'مُبطَل')
  check('G3 discarded ≠ voided', DOC_STATUS_LABELS.discarded !== DOC_STATUS_LABELS.voided, true)
  check('G4 lot voided label', LOT_STATUS_LABELS.voided, 'مُبطَلة')
  {
    const texts = [
      ...allInventoryLabels(),
      ...INVENTORY_SENTINELS.map((s) => INVENTORY_ERRORS[s].message),
      INVENTORY_UNRESOLVED_MESSAGE,
      INVENTORY_OWNER_ONLY_MESSAGE,
      COMMAND_ID_MESSAGE,
      NETWORK_UNRESOLVED_MESSAGE,
      LEAVE_WARNING,
      CATALOG_INCOMPLETE_MESSAGE,
      PHONE_LATIN_DIGITS_MESSAGE,
    ]
    check(
      'G5 forbidden word absent from every inventory text',
      texts.filter((t) => FORBIDDEN_WORDS.some((w) => t.includes(w))),
      [],
    )
  }

  return { passed, failures }
}
