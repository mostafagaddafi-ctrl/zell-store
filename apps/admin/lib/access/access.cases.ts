/**
 * حالات 0021-P (ب1) — الأغلفة وقرار الوصول، منطق خالص بس (من غير داتابيز ولا شبكة ولا متغيرات بيئة).
 * بتتشغّل فعليًا بـ: pnpm --filter @zell/admin cases  (suite: access)
 * العقد: docs/contracts/0021-P-code.md §٥.
 */

import {
  CAPABILITY_CATEGORY,
  UNIMPLEMENTED_CAPABILITY,
  ZELL_CAPABILITIES,
  isCapability,
  legacyAdminAllows,
  type Capability,
} from './capabilities'
import { mutationsFlagEnabled } from './flag'
import { readAccessMode, type AccessMode } from './mode'
import {
  authorize,
  parseMyAccess,
  type Authorization,
  type LegacyOutcome,
  type ResolveDeps,
  type SessionUser,
  type ShadowKind,
} from './resolve'
import {
  FORBIDDEN_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  UNIMPLEMENTED_MESSAGE,
  createAccessWrappers,
  type AccessDeps,
  type AccessFailure,
  type PageDenial,
} from './wrappers'

export type AccessCaseFailure = { name: string; expected: string; actual: string }
export type AccessCasesReport = { passed: number; failures: AccessCaseFailure[] }

const OWNER = { userId: 'u-owner', email: 'owner@zell.test', role: 'owner' as const }
const ADMIN = { userId: 'u-admin', email: 'admin@zell.test', role: 'admin' as const }
const SALES_CAP: Capability = 'zell.orders.view'
const OWNER_CAP: Capability = 'zell.coupons.edit'

type Spy = { myAccess: number; record: Array<[string, Capability, ShadowKind]>; session: number; legacy: number }

function makeResolveDeps(
  mode: AccessMode,
  legacy: LegacyOutcome | 'throw',
  myAccess: unknown | 'throw' | 'hang',
  session: SessionUser = { state: 'user', userId: 'u-x', email: 'x@zell.test' },
  recordFails = false,
): { deps: ResolveDeps; spy: Spy } {
  const spy: Spy = { myAccess: 0, record: [], session: 0, legacy: 0 }
  const deps: ResolveDeps = {
    mode: () => mode,
    legacy: async () => {
      spy.legacy++
      if (legacy === 'throw') throw new Error('legacy down')
      return legacy
    },
    sessionUser: async () => {
      spy.session++
      return session
    },
    myAccessRaw: () => {
      spy.myAccess++
      if (myAccess === 'throw') return Promise.reject(new Error('rpc down'))
      if (myAccess === 'hang') return new Promise<unknown>(() => undefined)
      return Promise.resolve(myAccess)
    },
    recordShadow: async (routeKey, capability, kind) => {
      spy.record.push([routeKey, capability, kind])
      if (recordFails) throw new Error('record down')
    },
    routeKey: async () => '/orders',
    readTimeoutMs: 30,
    shadowTimeoutMs: 30,
  }
  return { deps, spy }
}

function access(owner: boolean, active: boolean, caps: string[]): unknown {
  return { owner, active, capabilities: caps, version: 1 }
}

type WrapSpy = { gate: number; fn: number; pages: PageDenial[]; forms: AccessFailure[] }

function makeWrappers(auth: Authorization | 'throw', gate: AccessFailure | null) {
  const spy: WrapSpy = { gate: 0, fn: 0, pages: [], forms: [] }
  const seen: Array<Capability | null> = []
  const deps: AccessDeps = {
    authorize: async (capability) => {
      seen.push(capability)
      if (auth === 'throw') throw new Error('auth down')
      return auth
    },
    mutationsGate: () => {
      spy.gate++
      return gate
    },
    denyPage: (denial) => {
      spy.pages.push(denial)
      throw new Error('DENY_PAGE:' + denial)
    },
    denyFormAction: (failure) => {
      spy.forms.push(failure)
      throw new Error('DENY_FORM:' + failure.code)
    },
  }
  return { wrappers: createAccessWrappers(deps), spy, seen }
}

const DISABLED_GATE: AccessFailure = { ok: false, code: 'DISABLED', message: 'رسالة guardMutations' }

export async function runAccessCases(): Promise<AccessCasesReport> {
  let passed = 0
  const failures: AccessCaseFailure[] = []
  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed++
    else failures.push({ name, expected: e, actual: a })
  }

  // ── A. الصلاحيات ───────────────────────────────────────
  {
    check('A1 29 capabilities, unique', [ZELL_CAPABILITIES.length, new Set(ZELL_CAPABILITIES).size], [29, 29])
    const categories = ZELL_CAPABILITIES.map((c) => CAPABILITY_CATEGORY[c])
    check('A2 22 grantable (operational/sales), 7 owner', [categories.filter((c) => c !== 'owner').length, categories.filter((c) => c === 'owner').length], [22, 7])
    check('A3 isCapability', [isCapability('zell.orders.view'), isCapability('zell.nope'), isCapability('')], [true, false, false])
    check('A4 legacy admin: owner-class denied, others allowed', [legacyAdminAllows('zell.coupons.view'), legacyAdminAllows('zell.inventory0020.edit'), legacyAdminAllows('zell.unimplemented'), legacyAdminAllows('zell.orders.view'), legacyAdminAllows('zell.content.edit')], [false, false, false, true, true])
    check('A5 unimplemented capability is owner-class', CAPABILITY_CATEGORY[UNIMPLEMENTED_CAPABILITY], 'owner')
  }

  // ── B. قراية الوضع ─────────────────────────────────────
  {
    const r = (v: string | undefined) => { const x = readAccessMode(v); return x.mode + ':' + String(x.valid) }
    check('B1 missing/empty = legacy (valid)', [r(undefined), r('')], ['legacy:true', 'legacy:true'])
    check('B2 exact values', [r('legacy'), r('shadow'), r('enforce')], ['legacy:true', 'shadow:true', 'enforce:true'])
    check('B3 anything else = legacy (invalid)', [r('Enforce'), r(' enforce'), r('enforce '), r('on'), r('true')], ['legacy:false', 'legacy:false', 'legacy:false', 'legacy:false', 'legacy:false'])
  }

  // ── C. شكل رد zell_erp_my_access ──────────────────────
  {
    const ok = parseMyAccess(access(false, true, ['zell.orders.view']))
    check('C1 valid shape', ok === null ? null : [ok.owner, ok.active, [...ok.capabilities]], [false, true, ['zell.orders.view']])
    check('C2 invalid shapes -> null', [
      parseMyAccess(null), parseMyAccess([]), parseMyAccess('x'), parseMyAccess({ owner: 'true', active: true, capabilities: [] }),
      parseMyAccess({ owner: false, active: true }), parseMyAccess(access(false, true, ['zell.nope'])), parseMyAccess(access(false, true, [1 as unknown as string])),
    ].map((v) => v === null), [true, true, true, true, true, true, true])
  }

  // ── D. legacy: زي النهارده، ومن غير أي نداء zell_erp_* ─
  {
    const cases: Array<[string, LegacyOutcome | 'throw', Capability | null, string]> = [
      ['owner + owner cap', { state: 'authorized', identity: OWNER }, OWNER_CAP, 'allowed'],
      ['owner + sales cap', { state: 'authorized', identity: OWNER }, SALES_CAP, 'allowed'],
      ['admin + sales cap', { state: 'authorized', identity: ADMIN }, SALES_CAP, 'allowed'],
      ['admin + owner cap', { state: 'authorized', identity: ADMIN }, OWNER_CAP, 'denied'],
      ['admin + unimplemented', { state: 'authorized', identity: ADMIN }, UNIMPLEMENTED_CAPABILITY, 'denied'],
      ['admin + layout (null)', { state: 'authorized', identity: ADMIN }, null, 'allowed'],
      ['anonymous', { state: 'anonymous' }, SALES_CAP, 'anonymous'],
      ['forbidden', { state: 'forbidden' }, SALES_CAP, 'forbidden'],
      ['unavailable', { state: 'unavailable' }, SALES_CAP, 'unavailable'],
      ['legacy throws', 'throw', SALES_CAP, 'unavailable'],
    ]
    let calls = 0
    for (const [name, legacy, cap, expected] of cases) {
      const { deps, spy } = makeResolveDeps('legacy', legacy, access(true, true, []))
      const result = await authorize(deps, cap)
      check('D legacy ' + name, result.state, expected)
      calls += spy.myAccess + spy.record.length + spy.session
    }
    check('D legacy never calls zell_erp_* (my_access · shadow · session)', calls, 0)
  }

  // ── E. shadow: القرار من legacy، والاختلاف بيتسجّل ─────
  {
    const run = async (legacy: LegacyOutcome, myAccess: unknown, cap: Capability | null, recordFails = false) => {
      const { deps, spy } = makeResolveDeps('shadow', legacy, myAccess, undefined, recordFails)
      const result = await authorize(deps, cap)
      return { state: result.state, myAccess: spy.myAccess, record: spy.record.map((r) => r[2] + '@' + r[0]) }
    }
    const admin: LegacyOutcome = { state: 'authorized', identity: ADMIN }
    check('E1 same decision -> no record', await run(admin, access(false, true, [SALES_CAP]), SALES_CAP), { state: 'allowed', myAccess: 1, record: [] })
    check('E2 legacy allow, new deny', await run(admin, access(false, true, []), SALES_CAP), { state: 'allowed', myAccess: 1, record: ['legacy_allow_new_deny@/orders'] })
    check('E3 legacy deny, new allow', await run(admin, access(false, true, [OWNER_CAP]), OWNER_CAP), { state: 'denied', myAccess: 1, record: ['legacy_deny_new_allow@/orders'] })
    check('E4 rpc fails -> new_unavailable, decision stays legacy', await run(admin, 'throw', SALES_CAP), { state: 'allowed', myAccess: 1, record: ['new_unavailable@/orders'] })
    check('E5 rpc bad shape -> new_unavailable', await run(admin, { owner: 1 }, SALES_CAP), { state: 'allowed', myAccess: 1, record: ['new_unavailable@/orders'] })
    check('E6 rpc hangs -> timeout -> new_unavailable', await run(admin, 'hang', SALES_CAP), { state: 'allowed', myAccess: 1, record: ['new_unavailable@/orders'] })
    check('E7 record fails -> decision still legacy', await run(admin, access(false, true, []), SALES_CAP, true), { state: 'allowed', myAccess: 1, record: ['legacy_allow_new_deny@/orders'] })
    check('E8 inactive in new -> legacy allow, new deny', await run(admin, access(false, false, [SALES_CAP]), SALES_CAP), { state: 'allowed', myAccess: 1, record: ['legacy_allow_new_deny@/orders'] })
    check('E9 layout (null) -> no rpc', await run(admin, access(false, true, []), null), { state: 'allowed', myAccess: 0, record: [] })
    check('E10 anonymous -> no rpc', await run({ state: 'anonymous' }, access(false, true, []), SALES_CAP), { state: 'anonymous', myAccess: 0, record: [] })
    check('E11 owner: new owner too -> no record', await run({ state: 'authorized', identity: OWNER }, access(true, true, []), OWNER_CAP), { state: 'allowed', myAccess: 1, record: [] })
  }

  // ── F. enforce: القرار من zell_erp_my_access ───────────
  {
    const run = async (session: SessionUser, myAccess: unknown, cap: Capability | null) => {
      const { deps, spy } = makeResolveDeps('enforce', { state: 'authorized', identity: OWNER }, myAccess, session)
      const result = await authorize(deps, cap)
      const role = result.state === 'allowed' || result.state === 'denied' ? result.identity.role : null
      return { state: result.state, role, legacy: spy.legacy }
    }
    const user: SessionUser = { state: 'user', userId: 'u-1', email: 'u1@zell.test' }
    check('F1 anonymous', await run({ state: 'anonymous' }, access(true, true, []), SALES_CAP), { state: 'anonymous', role: null, legacy: 0 })
    check('F2 session unavailable', await run({ state: 'unavailable' }, access(true, true, []), SALES_CAP), { state: 'unavailable', role: null, legacy: 0 })
    check('F3 rpc fails -> unavailable', await run(user, 'throw', SALES_CAP), { state: 'unavailable', role: null, legacy: 0 })
    check('F4 bad shape -> unavailable', await run(user, { owner: true }, SALES_CAP), { state: 'unavailable', role: null, legacy: 0 })
    check('F5 rpc hangs -> unavailable', await run(user, 'hang', SALES_CAP), { state: 'unavailable', role: null, legacy: 0 })
    check('F6 inactive -> forbidden', await run(user, access(false, false, [SALES_CAP]), SALES_CAP), { state: 'forbidden', role: null, legacy: 0 })
    check('F7 owner -> allowed (any cap)', await run(user, access(true, true, []), OWNER_CAP), { state: 'allowed', role: 'owner', legacy: 0 })
    check('F8 admin with cap -> allowed', await run(user, access(false, true, [SALES_CAP]), SALES_CAP), { state: 'allowed', role: 'admin', legacy: 0 })
    check('F9 admin without cap -> denied', await run(user, access(false, true, [SALES_CAP]), OWNER_CAP), { state: 'denied', role: 'admin', legacy: 0 })
    check('F10 layout (null) -> allowed', await run(user, access(false, true, []), null), { state: 'allowed', role: 'admin', legacy: 0 })
  }

  // ── G. أكشن: نتايج الفشل والترتيب والعلم ───────────────
  {
    const action = async (auth: Authorization | 'throw', cap: Capability, gate: AccessFailure | null, mutates: boolean, forbiddenMessage?: string) => {
      const { wrappers, spy } = makeWrappers(auth, gate)
      const options = forbiddenMessage === undefined ? { mutates } : { mutates, forbiddenMessage }
      const fn = wrappers.actionWithAccess(cap, options, async (ctx, x: number) => {
        spy.fn++
        return { ok: true as const, data: x, by: ctx.identity.userId }
      })
      const result = await fn(7)
      return { result, gate: spy.gate, fn: spy.fn }
    }
    const allowedAdmin: Authorization = { state: 'allowed', identity: ADMIN }
    const deniedAdmin: Authorization = { state: 'denied', identity: ADMIN }
    check('G1 allowed -> fn runs with ctx and args', await action(allowedAdmin, SALES_CAP, null, true), { result: { ok: true, data: 7, by: 'u-admin' }, gate: 1, fn: 1 })
    check('G2 anonymous -> UNAUTHENTICATED (same message), no gate', await action({ state: 'anonymous' }, SALES_CAP, DISABLED_GATE, true), { result: { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }, gate: 0, fn: 0 })
    check('G3 unavailable -> UNAUTHENTICATED (like requireAdminAction)', await action({ state: 'unavailable' }, SALES_CAP, null, true), { result: { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }, gate: 0, fn: 0 })
    check('G4 authorize throws -> UNAUTHENTICATED', await action('throw', SALES_CAP, null, true), { result: { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }, gate: 0, fn: 0 })
    check('G5 forbidden (no admin row) -> FORBIDDEN', await action({ state: 'forbidden' }, SALES_CAP, null, true), { result: { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }, gate: 0, fn: 0 })
    check('G6 denied -> FORBIDDEN generic message', await action(deniedAdmin, OWNER_CAP, null, true), { result: { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }, gate: 0, fn: 0 })
    check('G7 denied -> area message when given', await action(deniedAdmin, OWNER_CAP, null, true, 'للمالك بس'), { result: { ok: false, code: 'FORBIDDEN', message: 'للمالك بس' }, gate: 0, fn: 0 })
    check('G8 unimplemented -> exact message', await action(deniedAdmin, UNIMPLEMENTED_CAPABILITY, null, true, 'للمالك بس'), { result: { ok: false, code: 'FORBIDDEN', message: 'العملية غير متاحة حاليًا.' }, gate: 0, fn: 0 })
    check('G9 UNIMPLEMENTED_MESSAGE text', UNIMPLEMENTED_MESSAGE, 'العملية غير متاحة حاليًا.')
    check('G10 mutates + gate closed -> exactly the gate result, after capability', await action(allowedAdmin, SALES_CAP, DISABLED_GATE, true), { result: DISABLED_GATE, gate: 1, fn: 0 })
    check('G11 mutates=false -> gate never consulted', await action(allowedAdmin, SALES_CAP, DISABLED_GATE, false), { result: { ok: true, data: 7, by: 'u-admin' }, gate: 0, fn: 1 })
    check('G12 owner on unimplemented -> reaches fn', await action({ state: 'allowed', identity: OWNER }, UNIMPLEMENTED_CAPABILITY, null, true), { result: { ok: true, data: 7, by: 'u-owner' }, gate: 1, fn: 1 })
    {
      const { wrappers } = makeWrappers(deniedAdmin, null)
      const fn = wrappers.actionWithAccess(OWNER_CAP, { mutates: true, mapFailure: (f) => ({ resolution: 'rejected', code: f.code, message: f.message }) }, async () => 'done')
      check('G13 mapFailure shapes the failure', await fn(), { resolution: 'rejected', code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE })
    }
    {
      const { wrappers, seen } = makeWrappers({ state: 'allowed', identity: ADMIN }, null)
      await wrappers.actionWithAccess(SALES_CAP, { mutates: false }, async () => 1)()
      check('G14 action passes its capability to authorize', seen, [SALES_CAP])
    }
  }

  // ── H. صفحات و layout ──────────────────────────────────
  {
    const page = async (auth: Authorization) => {
      const { wrappers, spy, seen } = makeWrappers(auth, DISABLED_GATE)
      const render = wrappers.pageWithAccess(SALES_CAP, async (ctx, props: { id: number }) => 'page:' + ctx.identity.role + ':' + String(props.id))
      let out: unknown
      try {
        out = await render({ id: 3 })
      } catch (error) {
        out = error instanceof Error ? error.message : 'error'
      }
      return { out, pages: spy.pages, gate: spy.gate, seen }
    }
    check('H1 allowed page renders (no flag check)', await page({ state: 'allowed', identity: ADMIN }), { out: 'page:admin:3', pages: [], gate: 0, seen: [SALES_CAP] })
    check('H2 anonymous -> denyPage anonymous', await page({ state: 'anonymous' }), { out: 'DENY_PAGE:anonymous', pages: ['anonymous'], gate: 0, seen: [SALES_CAP] })
    check('H3 forbidden -> denyPage forbidden', await page({ state: 'forbidden' }), { out: 'DENY_PAGE:forbidden', pages: ['forbidden'], gate: 0, seen: [SALES_CAP] })
    check('H4 unavailable -> denyPage unavailable', await page({ state: 'unavailable' }), { out: 'DENY_PAGE:unavailable', pages: ['unavailable'], gate: 0, seen: [SALES_CAP] })
    check('H5 denied -> denyPage forbidden (/403)', await page({ state: 'denied', identity: ADMIN }), { out: 'DENY_PAGE:forbidden', pages: ['forbidden'], gate: 0, seen: [SALES_CAP] })
    {
      const { wrappers, seen } = makeWrappers({ state: 'allowed', identity: OWNER }, null)
      const layout = wrappers.layoutWithSession(async (ctx, props: { children: string }) => ctx.identity.role + ':' + props.children)
      check('H6 layout asks with null capability', [await layout({ children: 'x' }), seen], ['owner:x', [null]])
    }
  }

  // ── I. راوتات ──────────────────────────────────────────
  {
    const route = async (auth: Authorization, gate: AccessFailure | null, mutates: boolean) => {
      const { wrappers, spy } = makeWrappers(auth, gate)
      const handler = wrappers.routeWithAccess(SALES_CAP, { mutates }, async () => {
        spy.fn++
        return Response.json({ ok: true }, { status: 200 })
      })
      const response = await handler(new Request('https://admin.example/api/x', { method: 'POST' }))
      return { status: response.status, body: await response.json(), fn: spy.fn }
    }
    check('I1 anonymous -> 401', await route({ state: 'anonymous' }, null, true), { status: 401, body: { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }, fn: 0 })
    check('I2 unavailable -> 401 (like today)', await route({ state: 'unavailable' }, null, true), { status: 401, body: { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }, fn: 0 })
    check('I3 forbidden -> 403', await route({ state: 'forbidden' }, null, true), { status: 403, body: { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }, fn: 0 })
    check('I4 gate closed -> 409 with gate body', await route({ state: 'allowed', identity: ADMIN }, DISABLED_GATE, true), { status: 409, body: DISABLED_GATE, fn: 0 })
    check('I5 allowed -> handler', await route({ state: 'allowed', identity: ADMIN }, null, true), { status: 200, body: { ok: true }, fn: 1 })
  }

  // ── J. form action ─────────────────────────────────────
  {
    const { wrappers, spy } = makeWrappers({ state: 'allowed', identity: ADMIN }, DISABLED_GATE)
    const form = wrappers.formActionWithAccess(SALES_CAP, { mutates: true }, async () => undefined)
    let out = ''
    try {
      await form(new FormData())
    } catch (error) {
      out = error instanceof Error ? error.message : 'error'
    }
    check('J1 form action + gate closed -> denyFormAction(DISABLED)', [out, spy.forms.map((f) => f.code)], ['DENY_FORM:DISABLED', ['DISABLED']])
  }

  // ── K. علم التعديلات: نفس شرط mutationsEnabled() (lib/mutations.ts بتنادي الدالة دي) ──
  {
    const f = mutationsFlagEnabled
    check('K1 true -> enabled (trim like today)', [f('true'), f(' true '), f('true\n')], [true, true, true])
    check('K2 false -> disabled', f('false'), false)
    check('K3 missing / empty -> disabled', [f(undefined), f('')], [false, false])
    check('K4 invalid -> disabled', [f('TRUE'), f('True'), f('1'), f('yes'), f('on'), f('enabled')], [false, false, false, false, false, false])
  }

  return { passed, failures }
}
