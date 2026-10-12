/**
 * حالات 0021-P (ب2) — جدول الربط (manifest) وتكافؤ legacy. منطق خالص بس (من غير داتابيز ولا شبكة).
 * بتتشغّل فعليًا بـ: pnpm --filter @zell/admin cases  (suite: manifest)
 * العقد: docs/contracts/0021-P-code.md §٧ و§١٠.
 *
 * لكل رمز من الـ 83 (79 من ب2 + 4 actions من 0021-A A2): نتيجة الغلاف في legacy لـ (anonymous · forbidden · unavailable · owner · admin) × (العلم مفتوح · مقفول)
 * = نتيجة النهارده (قبل ب2)، المحسوبة من عمودي todayGuard و todayFlag في الجدول — ماعدا الفرق المعتمد ٢ (zell.unimplemented).
 * وفي legacy مفيش ولا نداء zell_erp_* (sessionUser · myAccessRaw · recordShadow = صفر في كل الحالات).
 * التطابق بين الجدول والكود نفسه (الغلاف · الصلاحية · mutates · الرسالة): scripts/check-access-manifest.mjs في CI.
 */

import { UNIMPLEMENTED_CAPABILITY, isCapability, legacyAdminAllows } from './capabilities'
import { ACCESS_MANIFEST, type ManifestEntry } from './manifest'
import { authorize, type LegacyOutcome, type ResolveDeps } from './resolve'
import {
  FORBIDDEN_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  UNIMPLEMENTED_MESSAGE,
  createAccessWrappers,
  type AccessFailure,
  type ActionOptions,
} from './wrappers'

export type ManifestCaseFailure = { name: string; expected: string; actual: string }
export type ManifestCasesReport = { passed: number; failures: ManifestCaseFailure[] }

type StateName = 'anonymous' | 'forbidden' | 'unavailable' | 'owner' | 'admin'
const STATES: readonly StateName[] = ['anonymous', 'forbidden', 'unavailable', 'owner', 'admin']
const FLAGS: readonly boolean[] = [true, false]

const OUTCOMES: Readonly<Record<StateName, LegacyOutcome>> = {
  anonymous: { state: 'anonymous' },
  forbidden: { state: 'forbidden' },
  unavailable: { state: 'unavailable' },
  owner: { state: 'authorized', identity: { userId: 'u-owner', email: 'owner@zell.test', role: 'owner' } },
  admin: { state: 'authorized', identity: { userId: 'u-admin', email: 'admin@zell.test', role: 'admin' } },
}

/** نتيجة guardMutations() بتعدّي زي ما هي — قيمة مميزة علشان نتأكد إن هي نفسها اللي رجعت. */
const DISABLED_SENTINEL = 'guard-mutations-result'
const DISABLED_FAILURE: AccessFailure = { ok: false, code: 'DISABLED', message: DISABLED_SENTINEL }

/** الفرق المعتمد ٢ (العقد §٧ و§١٠): الأكشنز اللي لسه مش متعملة (النهارده بترجع INTERNAL «لسه ما اتعملش»). */
export const UNIMPLEMENTED_SYMBOLS: readonly string[] = [
  'deleteImageAction',
  'resendNotificationAction',
  'saveOperationalSettingsAction',
  'uploadProductImagePlaceholder',
]

const HTTP_STATUS: Readonly<Record<string, number>> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, DISABLED: 409 }

type Spy = { erp: number; gate: number }
type Observed = [text: string, gate: number, erp: number]

function legacyDeps(outcome: LegacyOutcome, spy: Spy): ResolveDeps {
  return {
    mode: () => 'legacy',
    legacy: async () => outcome,
    sessionUser: async () => {
      spy.erp++
      return { state: 'anonymous' }
    },
    myAccessRaw: async () => {
      spy.erp++
      return null
    },
    recordShadow: async () => {
      spy.erp++
    },
    routeKey: async () => '/manifest',
  }
}

function wrappersFor(state: StateName, flagOpen: boolean, spy: Spy) {
  return createAccessWrappers({
    authorize: (capability) => authorize(legacyDeps(OUTCOMES[state], spy), capability),
    mutationsGate: () => {
      spy.gate++
      return flagOpen ? null : DISABLED_FAILURE
    },
    denyPage: (denial) => {
      throw new Error('DENY_PAGE:' + denial)
    },
    denyFormAction: (failure) => {
      throw new Error('DENY_FORM:' + failure.code)
    },
  })
}

async function settle(run: () => Promise<unknown>): Promise<string> {
  try {
    const value = await run()
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch (error) {
    return error instanceof Error ? error.message : 'error'
  }
}

function describeFailure(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'NOT_A_FAILURE'
  const record = value as Record<string, unknown>
  return String(record['code']) + '|' + String(record['message'])
}

/** النهارده (قبل ب2): requireAdminPage / requireAdminAction ← ownerGate (لو todayGuard = owner) ← guardMutations (لو todayFlag). */
function expectedToday(entry: ManifestEntry, state: StateName, flagOpen: boolean): Observed {
  const role = state === 'owner' ? 'owner' : 'admin'
  const ownerBlocksAdmin = entry.todayGuard === 'owner'
  if (entry.kind === 'page' || entry.kind === 'layout') {
    if (state === 'anonymous' || state === 'unavailable' || state === 'forbidden') return ['DENY_PAGE:' + state, 0, 0]
    if (state === 'admin' && ownerBlocksAdmin) return ['DENY_PAGE:forbidden', 0, 0]
    return ['render:' + role, 0, 0]
  }
  let code: string | null = null
  let message = ''
  let gate = 0
  if (state === 'anonymous' || state === 'unavailable') {
    code = 'UNAUTHENTICATED'
    message = UNAUTHENTICATED_MESSAGE
  } else if (state === 'forbidden') {
    code = 'FORBIDDEN'
    message = FORBIDDEN_MESSAGE
  } else if (state === 'admin' && entry.capability === UNIMPLEMENTED_CAPABILITY) {
    // الفرق المعتمد ٢: الأدمن بياخد الرسالة دي بالحرف بدل رسالة الدالة.
    code = 'FORBIDDEN'
    message = UNIMPLEMENTED_MESSAGE
  } else if (state === 'admin' && ownerBlocksAdmin) {
    code = 'FORBIDDEN'
    message = entry.forbiddenMessage !== null ? 'msg:' + entry.forbiddenMessage : FORBIDDEN_MESSAGE
  } else if (entry.todayFlag && !flagOpen) {
    code = 'DISABLED'
    message = DISABLED_SENTINEL
    gate = 1
  } else {
    gate = entry.todayFlag ? 1 : 0
  }
  if (entry.kind === 'route') {
    if (code === null) return ['http:200|fn:' + role, gate, 0]
    return ['http:' + String(HTTP_STATUS[code]) + '|' + code + '|' + message, gate, 0]
  }
  if (code === null) return ['fn:' + role, gate, 0]
  return [(entry.mapFailure !== null ? 'mapped|' : '') + code + '|' + message, gate, 0]
}

async function observe(entry: ManifestEntry, state: StateName, flagOpen: boolean): Promise<Observed> {
  const spy: Spy = { erp: 0, gate: 0 }
  const w = wrappersFor(state, flagOpen, spy)
  let text: string
  if (entry.kind === 'layout') {
    const layout = w.layoutWithSession(async (ctx, _props: { children: string }) => 'render:' + ctx.identity.role)
    text = await settle(() => layout({ children: 'x' }))
  } else if (entry.capability === null) {
    text = 'NO_CAPABILITY'
  } else if (entry.kind === 'page') {
    const page = w.pageWithAccess(entry.capability, async (ctx, _props: { id?: string }) => 'render:' + ctx.identity.role)
    text = await settle(() => page({}))
  } else if (entry.kind === 'route') {
    const options =
      entry.forbiddenMessage !== null
        ? { mutates: entry.mutates, forbiddenMessage: 'msg:' + entry.forbiddenMessage }
        : { mutates: entry.mutates }
    const route = w.routeWithAccess(entry.capability, options, async (ctx, _request: Request) =>
      Response.json({ ok: true, fn: ctx.identity.role }),
    )
    const response = await route(new Request('http://admin.test/manifest', { method: 'POST' }))
    const body = (await response.json()) as Record<string, unknown>
    const fn = body['fn']
    text = 'http:' + String(response.status) + '|' + (typeof fn === 'string' ? 'fn:' + fn : String(body['code']) + '|' + String(body['message']))
  } else {
    const options: ActionOptions<string> = {
      mutates: entry.mutates,
      ...(entry.forbiddenMessage !== null ? { forbiddenMessage: 'msg:' + entry.forbiddenMessage } : {}),
      ...(entry.mapFailure !== null ? { mapFailure: (f: AccessFailure) => 'mapped|' + f.code + '|' + f.message } : {}),
    }
    const action = w.actionWithAccess(entry.capability, options, async (ctx) => 'fn:' + ctx.identity.role)
    const result: unknown = await action()
    text = typeof result === 'string' ? result : describeFailure(result)
  }
  return [text, spy.gate, spy.erp]
}

export async function runManifestCases(): Promise<ManifestCasesReport> {
  let passed = 0
  const failures: ManifestCaseFailure[] = []
  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed++
    else failures.push({ name, expected: e, actual: a })
  }

  const all = ACCESS_MANIFEST
  const count = (kind: ManifestEntry['kind']) => all.filter((e) => e.kind === kind).length

  // ── M. الجدول نفسه ──────────────────────────────────────
  check('M1 93 symbols: 64 action · 25 page · 1 layout · 3 route (79 من ب2 + 4 من 0021-A A2 + 9 من 0021-A P2 + 1 من 0021-D2 W2)', [all.length, count('action'), count('page'), count('layout'), count('route')], [93, 64, 25, 1, 3])
  check('M2 file + symbol unique', new Set(all.map((e) => e.file + '#' + e.symbol)).size, 93)
  check(
    'M3 capability is one of the 29 (layout = null only)',
    all.filter((e) => (e.kind === 'layout' ? e.capability !== null : e.capability === null || !isCapability(e.capability))).map((e) => e.symbol + '@' + e.file),
    [],
  )
  check('M4 mutates = today flag check (no flag difference)', all.filter((e) => e.mutates !== e.todayFlag).map((e) => e.symbol), [])
  check('M5 pages and layout never mutate', all.filter((e) => (e.kind === 'page' || e.kind === 'layout') && e.mutates).map((e) => e.file), [])
  check(
    'M6 owner category = owner-only today (except unimplemented)',
    all
      .filter((e) => e.capability !== null && e.capability !== UNIMPLEMENTED_CAPABILITY)
      .filter((e) => (e.capability !== null && legacyAdminAllows(e.capability)) !== (e.todayGuard === 'admin'))
      .map((e) => e.symbol + '@' + e.file),
    [],
  )
  check(
    'M7 unimplemented = approved list (difference 2), all admin-guarded today',
    all
      .filter((e) => e.capability === UNIMPLEMENTED_CAPABILITY)
      .map((e) => e.symbol + ':' + e.todayGuard)
      .sort(),
    [...UNIMPLEMENTED_SYMBOLS].map((s) => s + ':admin').sort(),
  )
  check(
    'M8 owner-only actions carry their «owner only» message, nothing else does',
    all.filter((e) => (e.kind === 'action' && e.todayGuard === 'owner') !== (e.forbiddenMessage !== null)).map((e) => e.symbol),
    [],
  )
  check(
    'M9 mapFailure only on inventory actions (InventoryFailure shape)',
    all.filter((e) => (e.file === 'lib/inventoryActions.ts') !== (e.mapFailure === 'rejectedFailure')).map((e) => e.symbol),
    [],
  )

  // ── P. تكافؤ legacy لكل رمز × كل حالة × العلم ─────────────────────
  for (const entry of all) {
    for (const state of STATES) {
      for (const flagOpen of FLAGS) {
        const name = 'P ' + entry.kind + ' ' + entry.symbol + ' @ ' + entry.file + ' · ' + state + ' · flag ' + (flagOpen ? 'open' : 'closed')
        check(name, await observe(entry, state, flagOpen), expectedToday(entry, state, flagOpen))
      }
    }
  }

  return { passed, failures }
}
