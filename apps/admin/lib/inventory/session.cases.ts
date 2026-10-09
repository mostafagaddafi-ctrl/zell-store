/**
 * حالات 0020-S PR-2 — نداء المخزون بجلسة المستخدم. منطق خالص، من غير داتابيز ولا شبكة.
 *
 * بتتشغّل بـ: pnpm --filter @zell/admin cases  (suite = session)
 *   • تكافؤ لكل اسم من الـ 23: رد الجلسة بيطلّع نفس InventoryFailure اللي failureFromSentinel بيطلّعه (نفس اللي
 *     الطريق القديم كان بيوصله)، بالاسم الكامل وبالبادئة «CODE:» وبـ details، ومن غير أي تفاصيل بتعدّي.
 *   • الحالات اللي مش اسم: 401 · 403 · شبكة · أسماء قديمة برّه المخزون · شكل غلط · نجاح.
 *   • جدول الأسماء: 21 دالة = الأسماء القديمة بعد zell_inv_session_، ومفيش اسم قديم.
 */

import { INVENTORY_ERRORS, INVENTORY_UNRESOLVED_MESSAGE, failureFromSentinel } from './errors'
import { INVENTORY_SENTINELS, INVENTORY_SQLSTATE } from './sentinels'
import {
  INVENTORY_SESSION_FUNCTIONS,
  SESSION_UNAUTHENTICATED_MESSAGE,
  sentinelFromSessionError,
  sessionResult,
} from './sessionCall'

export type SessionCaseFailure = { name: string; expected: string; actual: string }
export type SessionCasesReport = { passed: number; failures: SessionCaseFailure[] }

/** جدول الأسماء قبل PR-2 (lib/inventory/rpc.ts على main 9dbef73) — للتكافؤ. */
const LEGACY_FUNCTIONS: Record<string, string> = {
  listSuppliers: 'zell_inv_list_suppliers',
  createSupplier: 'zell_inv_create_supplier',
  updateSupplier: 'zell_inv_update_supplier',
  listLocations: 'zell_inv_list_locations',
  listPurchases: 'zell_inv_list_purchases',
  getPurchase: 'zell_inv_get_purchase',
  previewPurchase: 'zell_inv_preview_purchase',
  createPurchase: 'zell_inv_create_purchase',
  updatePurchase: 'zell_inv_update_purchase',
  postPurchase: 'zell_inv_post_purchase',
  discardPurchase: 'zell_inv_discard_purchase',
  voidPurchase: 'zell_inv_void_purchase',
  listOpenings: 'zell_inv_list_openings',
  getOpening: 'zell_inv_get_opening',
  previewOpening: 'zell_inv_preview_opening',
  createOpening: 'zell_inv_create_opening',
  updateOpening: 'zell_inv_update_opening',
  postOpening: 'zell_inv_post_opening',
  discardOpening: 'zell_inv_discard_opening',
  voidOpening: 'zell_inv_void_opening',
  listLots: 'zell_inv_list_lots',
}

const LEGACY_NON_INVENTORY = [
  'ZELL_INVALID_ORDER',
  'ZELL_INVALID_SHIPPING',
  'ZELL_INVALID_IDENTITY',
  'ZELL_INVALID_COLLECTION',
  'ZELL_INVALID_COLLECTION_PRODUCTS',
  'ZELL_COLLECTION_SLUG_TAKEN',
  'ZELL_ORDER_CANCELLED_FINAL',
]

const UNRESOLVED = { ok: false, code: 'INTERNAL', message: INVENTORY_UNRESOLVED_MESSAGE, resolution: 'unresolved' }

function show(value: unknown): string {
  return JSON.stringify(value)
}

const reject = (_value: unknown): null => null
const accept = (value: unknown): unknown => value

export function runSessionCases(): SessionCasesReport {
  const failures: SessionCaseFailure[] = []
  let passed = 0
  const check = (name: string, actual: unknown, expected: unknown): void => {
    if (show(actual) === show(expected)) passed += 1
    else failures.push({ name, expected: show(expected), actual: show(actual) })
  }

  // ── تكافؤ لكل اسم من الـ 23 ──
  for (const sentinel of INVENTORY_SENTINELS) {
    const expected = failureFromSentinel(sentinel)
    const entry = INVENTORY_ERRORS[sentinel]
    check(sentinel + ' table entry intact', [expected.code, expected.message, expected.resolution], [entry.category, entry.message, entry.resolution])
    check(
      sentinel + ' exact message (status 400, sqlstate ' + INVENTORY_SQLSTATE[sentinel] + ')',
      sessionResult({ data: null, error: { message: sentinel, code: INVENTORY_SQLSTATE[sentinel], details: 'lines[0].kind', hint: null }, status: 400 }, accept),
      expected,
    )
    check(
      sentinel + ' prefixed message «CODE: …»',
      sessionResult({ data: null, error: { message: sentinel + ': extra', code: INVENTORY_SQLSTATE[sentinel] }, status: 400 }, accept),
      expected,
    )
    check(
      sentinel + ' details fallback when message is not a string',
      sessionResult({ data: null, error: { message: 42, details: sentinel }, status: 400 }, accept),
      expected,
    )
    check(
      sentinel + ' wins over status 401',
      sessionResult({ data: null, error: { message: sentinel }, status: 401 }, accept),
      expected,
    )
    check(
      sentinel + ' with a suffix that is not «:» is not a match',
      sentinelFromSessionError({ message: sentinel + 'X' }),
      null,
    )
  }

  // ── مش اسم ──
  check(
    '401 (expired session / no JWT) -> UNAUTHENTICATED, rejected, wrapper message',
    sessionResult({ data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }, accept),
    { ok: false, code: 'UNAUTHENTICATED', message: SESSION_UNAUTHENTICATED_MESSAGE, resolution: 'rejected' },
  )
  check('wrapper message text', SESSION_UNAUTHENTICATED_MESSAGE, 'لازم تسجّل دخول الأول.')
  check(
    '403 permission denied -> INTERNAL unresolved',
    sessionResult({ data: null, error: { message: 'permission denied for function zell_inv_session_list_lots', code: '42501' }, status: 403 }, accept),
    UNRESOLVED,
  )
  check(
    'network / timeout (status 0) -> INTERNAL unresolved',
    sessionResult({ data: null, error: { message: 'AbortError: signal timed out', details: '' }, status: 0 }, accept),
    UNRESOLVED,
  )
  for (const legacy of LEGACY_NON_INVENTORY) {
    check(legacy + ' (not inventory) -> INTERNAL unresolved', sessionResult({ data: null, error: { message: legacy }, status: 400 }, accept), UNRESOLVED)
  }
  check('error that is a string -> INTERNAL', sessionResult({ data: null, error: 'boom', status: 500 }, accept), UNRESOLVED)
  check('error that is an array -> INTERNAL', sessionResult({ data: null, error: ['ZELL_INV_FORBIDDEN'], status: 400 }, accept), UNRESOLVED)
  check('error with empty message -> INTERNAL', sessionResult({ data: null, error: { message: '' }, status: 400 }, accept), UNRESOLVED)
  check('success, parse ok -> ok', sessionResult({ data: { a: 1 }, error: null, status: 200 }, accept), { ok: true, data: { a: 1 } })
  check('success, parse null -> INTERNAL unresolved', sessionResult({ data: { a: 1 }, error: null, status: 200 }, reject), UNRESOLVED)
  check('success, undefined error -> parsed', sessionResult({ data: 5, error: undefined, status: 200 }, accept), { ok: true, data: 5 })
  check(
    'failure shape keys',
    Object.keys(sessionResult({ data: null, error: { message: 'ZELL_INV_CONFLICT' }, status: 400 }, accept)),
    ['ok', 'code', 'message', 'resolution'],
  )

  // ── جدول الأسماء ──
  const keys = Object.keys(INVENTORY_SESSION_FUNCTIONS)
  check('21 functions', keys.length, 21)
  check('same keys as before PR-2', keys.slice().sort(), Object.keys(LEGACY_FUNCTIONS).sort())
  const table = INVENTORY_SESSION_FUNCTIONS as Record<string, string>
  for (const key of keys) {
    check(key + ' = legacy name with zell_inv_session_', table[key], (LEGACY_FUNCTIONS[key] ?? '').replace(/^zell_inv_/, 'zell_inv_session_'))
  }
  check('no duplicate names', new Set(Object.values(table)).size, keys.length)

  return { passed, failures }
}
