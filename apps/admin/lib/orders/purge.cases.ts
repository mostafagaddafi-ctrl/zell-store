/**
 * ORDER-DELETE (المرحلة C) — حالات منطق شاشة حذف الطلبات بنتايج محاكاة (منطق خالص — pnpm --filter @zell/admin cases).
 */

import {
  EMPTY_PURGE_FORM,
  ORDER_PURGE_MESSAGES,
  ORDER_PURGE_OWNER_ONLY_MESSAGE,
  TEMP_AUTH_OPTIONS,
  ordersCountText,
  parsePurgePreview,
  parsePurgeResult,
  parseReauthBegin,
  parseReauthFinish,
  previewFailure,
  purgeCanConfirm,
  purgeDoneNotice,
  purgeErrorCode,
  purgeFailure,
  purgeFormAfterFailure,
  purgeInputIssue,
  purgePhrase,
  purgeSummary,
  runOrderPurge,
  sessionIdFromToken,
  validIds,
  verifyOwnerPassword,
  type PurgeForm,
  type PurgeRequest,
  type PurgeSteps,
  type TempAuthClient,
  type TempAuthOptions,
} from './purge'

export type PurgeCaseFailure = { name: string; expected: string; actual: string }

const failures: PurgeCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const H1 = '0123456789abcdef0123456789abcdef'
const H2 = 'fedcba9876543210fedcba9876543210'
const T1 = '11111111-2222-4333-8444-555555555555'
const S1 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const AT = '2026-11-04T10:00:00.123456+00:00'

const order = (id: number, n: string) => ({
  id, order_number: n, created_at: AT, customer_name: 'عميل', customer_phone: '01000000000', status: 'new',
  total_piastres: 35000, payments_count: 1, received_piastres: 10000, refunded_piastres: 0,
})
const RAW = {
  actor: S1, ids: [3, 7], count: 2, ids_hash: H1, snapshot_hash: H2, payments_count: 2, received_piastres: 20000, refunded_piastres: 2000,
  orders: [order(3, 'FLM-AAAA'), order(7, 'FLM-BBBB')],
}

function req(over: Partial<PurgeRequest> = {}): PurgeRequest {
  return { scope: 'all', ids: [3, 7], idsHash: H1, snapshotHash: H2, count: 2, phrase: 'احذف طلبين', backupConfirmed: true, password: 'secret', ...over }
}

type Log = string[]
function steps(log: Log, over: Partial<PurgeSteps> = {}): PurgeSteps {
  return {
    begin: async () => { log.push('begin'); return { allowed: true, attempt: 1 } },
    verifyPassword: async () => { log.push('verify'); return true },
    finish: async (ok: boolean) => { log.push('finish:' + String(ok)); return ok ? { ticket: T1 } : { ticket: null, locked: false } },
    purge: async (ticket: string) => {
      log.push('purge:' + ticket)
      return { data: { deleted: 2, order_numbers: ['FLM-AAAA', 'FLM-BBBB'], payments_count: 2, received_piastres: 20000, refunded_piastres: 2000, remaining_orders: 1 }, error: null }
    },
    ...over,
  }
}

export async function runOrderPurgeCases(): Promise<{ passed: number; failures: PurgeCaseFailure[] }> {
  // المعاينة
  const p = parsePurgePreview(RAW)
  check('P01 parse the preview reply', p === null ? null : [p.count, p.ids, p.idsHash, p.snapshotHash, p.orders.map((o) => o.orderNumber), p.receivedPiastres], [2, [3, 7], H1, H2, ['FLM-AAAA', 'FLM-BBBB'], 20000])
  check('P02 empty preview (no orders) is accepted', parsePurgePreview({ ...RAW, ids: [], count: 0, orders: [], payments_count: 0, received_piastres: 0, refunded_piastres: 0 })?.count, 0)
  check('P03 bad shapes = null', [
    parsePurgePreview(null),
    parsePurgePreview({ ...RAW, count: 3 }),
    parsePurgePreview({ ...RAW, ids: [7, 3] }),
    parsePurgePreview({ ...RAW, snapshot_hash: 'x' }),
    parsePurgePreview({ ...RAW, orders: [order(3, 'A')] }),
    parsePurgePreview({ ...RAW, orders: [order(7, 'B'), order(3, 'A')] }),
    parsePurgePreview({ ...RAW, orders: [{ ...order(3, 'A'), total_piastres: -1 }, order(7, 'B')] }),
  ], [null, null, null, null, null, null, null])
  check('P04 ids: positive, unique, ascending, within the limit', [validIds([1, 2, 9]), validIds([]), validIds([2, 2]), validIds([3, 1]), validIds([0]), validIds([1.5])], [true, false, false, false, false, false])

  // النتيجة
  check('R01 parse the purge reply', parsePurgeResult({ deleted: 1, order_numbers: ['FLM-A'], payments_count: 0, received_piastres: 0, refunded_piastres: 0, remaining_orders: 0 }),
    { deleted: 1, orderNumbers: ['FLM-A'], paymentsCount: 0, receivedPiastres: 0, refundedPiastres: 0, remainingOrders: 0 })
  check('R02 bad purge replies = null', [parsePurgeResult(null), parsePurgeResult({ deleted: 2, order_numbers: ['A'], payments_count: 0, received_piastres: 0, refunded_piastres: 0, remaining_orders: 0 })], [null, null])

  // النصوص
  check('X01 count words', [ordersCountText(1), ordersCountText(2), ordersCountText(4), ordersCountText(11)], ['طلب واحد', 'طلبان', '4 طلبات', '11 طلبًا'])
  check('X02 confirmation phrase has the count', [purgePhrase(1), purgePhrase(2), purgePhrase(4), purgePhrase(25)], ['احذف طلبًا واحدًا', 'احذف طلبين', 'احذف 4 طلبات', 'احذف 25 طلبًا'])
  check('X03 summary line: orders · payments · received · refunded', p === null ? null : purgeSummary(p, (v) => String(v / 100)), 'سيُحذف طلبان · 2 دفعة · المقبوض 200 · المردود 20')
  check('X04 done notice with remaining orders', [
    purgeDoneNotice({ deleted: 4, orderNumbers: ['a', 'b', 'c', 'd'], paymentsCount: 0, receivedPiastres: 0, refundedPiastres: 0, remainingOrders: 0 }),
    purgeDoneNotice({ deleted: 2, orderNumbers: ['a', 'b'], paymentsCount: 0, receivedPiastres: 0, refundedPiastres: 0, remainingOrders: 1 }),
  ], ['تم حذف 4 طلبات. لا توجد طلبات أخرى.', 'تم حذف طلبان. بقي طلب واحد وصل بعد عرض القائمة ولم يُحذف.'])
  check('X05 wrapper refusal message is about deleting orders (owner only)', ORDER_PURGE_OWNER_ONLY_MESSAGE, 'حذف الطلبات متاح للمالك فقط.')

  // التحقق قبل أي نداء
  check('V01 valid full purge', purgeInputIssue(req()), null)
  check('V02 valid single delete (no backup box needed)', purgeInputIssue(req({ scope: 'single', ids: [3], count: 1, phrase: 'احذف طلبًا واحدًا', backupConfirmed: false })), null)
  check('V03 refusals', [
    purgeInputIssue(req({ phrase: 'احذف 2 طلبات' })),
    purgeInputIssue(req({ backupConfirmed: false })),
    purgeInputIssue(req({ password: '' })),
    purgeInputIssue(req({ count: 3 })),
    purgeInputIssue(req({ scope: 'single' })),
    purgeInputIssue(req({ snapshotHash: 'nope' })),
    purgeInputIssue(req({ ids: [7, 3] })),
  ], [ORDER_PURGE_MESSAGES.phrase, ORDER_PURGE_MESSAGES.backup, ORDER_PURGE_MESSAGES.passwordEmpty, ORDER_PURGE_MESSAGES.invalid, ORDER_PURGE_MESSAGES.invalid, ORDER_PURGE_MESSAGES.invalid, ORDER_PURGE_MESSAGES.invalid])

  // الأكواد
  check('E01 codes from supabase-js errors and sentinel names', [
    purgeErrorCode({ code: '45605', message: 'x' }),
    purgeErrorCode({ code: 'P0001', message: 'ZELL_PURGE_BUSY' }),
    purgeErrorCode(new Error('ZELL_PURGE_FORBIDDEN')),
    purgeErrorCode({ message: 'other' }),
    purgeErrorCode('text'),
  ], ['45605', '45608', '45603', null, null])
  check('E02 every code maps to a fixed message', ['45400', '45402', '45603', '45601', '45602', '45604', '45605', '45606', '45607', '45608', '99999'].map((c) => purgeFailure({ code: c }).code), [
    'UNAUTHENTICATED', 'FORBIDDEN', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'INTERNAL',
  ])
  check('E03 snapshot changed / busy messages say nothing was deleted', [purgeFailure({ code: '45605' }).message, purgeFailure({ code: '45608' }).message], [ORDER_PURGE_MESSAGES.changed, ORDER_PURGE_MESSAGES.busy])
  check('E04 reauth replies', [
    parseReauthBegin({ allowed: true, attempt: 2 }), parseReauthBegin({ allowed: false, locked_until: AT }), parseReauthBegin({}),
    parseReauthFinish({ ticket: T1 }), parseReauthFinish({ ticket: null, locked: true }), parseReauthFinish({ ticket: 'x' }),
  ], [{ allowed: true }, { allowed: false }, null, { ticket: T1 }, { ticket: null, locked: true }, null])

  // ترتيب الخطوات
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log))
    check('F01 success: begin -> password -> finish(true) -> purge with the ticket, once each', [r.ok, log], [true, ['begin', 'verify', 'finish:true', 'purge:' + T1]])
    check('F02 success data', r.ok ? [r.data.deleted, r.data.remainingOrders] : null, [2, 1])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req({ phrase: 'خطأ' }), steps(log))
    check('F03 invalid input: no call at all', [r.ok ? null : r.message, log], [ORDER_PURGE_MESSAGES.phrase, []])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, { begin: async () => { log.push('begin'); return { allowed: false, locked_until: AT } } }))
    check('F04 locked at begin: no password check, no purge', [r.ok ? null : r.message, log], [ORDER_PURGE_MESSAGES.locked, ['begin']])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, { verifyPassword: async () => { log.push('verify'); return false } }))
    check('F05 wrong password: finish(false), no ticket, no purge', [r.ok ? null : r.message, log], [ORDER_PURGE_MESSAGES.wrongPassword, ['begin', 'verify', 'finish:false']])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, {
      verifyPassword: async () => { log.push('verify'); return false },
      finish: async (ok: boolean) => { log.push('finish:' + String(ok)); return { ticket: null, locked: true } },
    }))
    check('F06 wrong password reaching the limit: locked message, no purge', [r.ok ? null : r.message, log], [ORDER_PURGE_MESSAGES.locked, ['begin', 'verify', 'finish:false']])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, { verifyPassword: async () => { log.push('verify'); return null } }))
    check('F07 password check unavailable: no finish, no purge', [r.ok ? null : r.message, log], [ORDER_PURGE_MESSAGES.passwordUnavailable, ['begin', 'verify']])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, { purge: async (t: string) => { log.push('purge:' + t); return { data: null, error: { code: '45605', message: 'ZELL_PURGE_SNAPSHOT_CHANGED' } } } }))
    check('F08 snapshot changed at purge: CONFLICT, nothing deleted message', [r.ok ? null : [r.code, r.message], log.length], [['CONFLICT', ORDER_PURGE_MESSAGES.changed], 4])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, { purge: async () => { log.push('purge'); throw new Error('network') } }))
    check('F09 purge result unknown (network): INTERNAL asks to reload the list, no retry', [r.ok ? null : [r.code, r.message], log.filter((x) => x === 'purge').length], [['INTERNAL', ORDER_PURGE_MESSAGES.internal], 1])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, { finish: async (ok: boolean) => { log.push('finish:' + String(ok)); return { ticket: null, locked: false } } }))
    check('F10 correct password but no ticket: no purge', [r.ok ? null : r.code, log], ['INTERNAL', ['begin', 'verify', 'finish:true']])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, { begin: async () => { log.push('begin'); throw { code: '45603', message: 'ZELL_PURGE_FORBIDDEN' } } }))
    check('F11 begin refused (not the owner): FORBIDDEN, nothing else', [r.ok ? null : r.code, log], ['FORBIDDEN', ['begin']])
  }
  {
    const log: Log = []
    const r = await runOrderPurge(req(), steps(log, { purge: async () => ({ data: { deleted: 1, order_numbers: ['A'], payments_count: 0, received_piastres: 0, refunded_piastres: 0, remaining_orders: 0 }, error: null }) }))
    check('F12 reply count different from the request = INTERNAL (not shown as success)', r.ok ? 'ok' : r.code, 'INTERNAL')
  }

  // رقم الجلسة من التوكن
  const enc = (o: unknown) => 'h.' + JSON.stringify(o) + '.s'
  const dec = (s: string) => s
  check('S01 session_id from the token payload', [
    sessionIdFromToken(enc({ session_id: S1 }), dec),
    sessionIdFromToken(enc({ session_id: 'nope' }), dec),
    sessionIdFromToken('a.b', dec),
    sessionIdFromToken(null, dec),
  ], [S1, null, null, null])

  // رسايل المعاينة منفصلة عن رفض الحذف (B1)
  {
    const nf = previewFailure({ code: '45602', message: 'ZELL_PURGE_NOT_FOUND' })
    check('B01 preview: a missing order does NOT say «nothing was deleted» (a previous attempt may have deleted it)', [nf.code, nf.message, nf.message.includes('لم يُحذف شيء')], ['NOT_FOUND', ORDER_PURGE_MESSAGES.previewNotFound, false])
    check('B02 preview: other codes', ['45400', '45402', '45601', '99999'].map((c) => previewFailure({ code: c }).message), [
      ORDER_PURGE_MESSAGES.unauthenticated, ORDER_PURGE_MESSAGES.forbidden, ORDER_PURGE_MESSAGES.previewInvalid, ORDER_PURGE_MESSAGES.previewUnavailable,
    ])
  }

  // حالة الكارت اللي الواجهة بتستخدمها فعليًا (B1)
  {
    const preview = parsePurgePreview(RAW)
    const full: PurgeForm = { preview, phrase: 'احذف طلبين', backup: true, password: 'secret' }
    check('B03 ready form can confirm', purgeCanConfirm(full, 'all', true, false), true)
    const unknown = purgeFormAfterFailure(full, { code: 'INTERNAL' })
    check('B04 after an UNKNOWN result: the old preview is gone, and typing the password again alone cannot re-enable delete', [
      unknown, purgeCanConfirm({ ...unknown, password: 'secret' }, 'all', true, false),
    ], [EMPTY_PURGE_FORM, false])
    const changed = purgeFormAfterFailure(full, { code: 'CONFLICT' })
    check('B05 after snapshot changed / busy / ticket (CONFLICT): same — preview gone, password alone cannot confirm', purgeCanConfirm({ ...changed, password: 'secret' }, 'all', true, false), false)
    const gone = purgeFormAfterFailure(full, { code: 'NOT_FOUND' })
    const denied = purgeFormAfterFailure(full, { code: 'FORBIDDEN' })
    check('B06 after NOT_FOUND / FORBIDDEN / UNAUTHENTICATED: preview gone', [gone.preview, denied.preview, purgeFormAfterFailure(full, { code: 'UNAUTHENTICATED' }).preview], [null, null, null])
    const wrong = purgeFormAfterFailure(full, { code: 'VALIDATION' })
    check('B07 after a wrong password (VALIDATION): preview and confirmations kept, only the password cleared; retyping it re-enables', [
      wrong.preview === preview, wrong.phrase, wrong.backup, wrong.password, purgeCanConfirm({ ...wrong, password: 'secret' }, 'all', true, false),
    ], [true, 'احذف طلبين', true, '', true])
    check('B08 confirm needs: exact phrase · backup for all only · password · mutations on · not busy · a non-empty preview', [
      purgeCanConfirm({ ...full, phrase: 'احذف 2 طلبات' }, 'all', true, false),
      purgeCanConfirm({ ...full, backup: false }, 'all', true, false),
      purgeCanConfirm({ ...full, backup: false }, 'single', true, false),
      purgeCanConfirm({ ...full, password: '' }, 'all', true, false),
      purgeCanConfirm(full, 'all', false, false),
      purgeCanConfirm(full, 'all', true, true),
      purgeCanConfirm(EMPTY_PURGE_FORM, 'all', true, false),
    ], [false, false, true, false, false, false, false])
  }

  // adapter المصادقة نفسه بعميل محاكاة (B2)
  {
    type SignReply = Awaited<ReturnType<TempAuthClient['auth']['signInWithPassword']>>
    type OutReply = Awaited<ReturnType<TempAuthClient['auth']['signOut']>>
    const UID = '00000000-0000-4000-8000-0000000000b1'
    const ok: SignReply = { data: { user: { id: UID }, session: { access_token: 't' } }, error: null }
    // العميل الأصلي (جلسة المتصفح): أي نداء عليه بيتعدّ
    const original = { signIn: 0, signOut: 0 }
    const originalClient: TempAuthClient = {
      auth: {
        signInWithPassword: async () => { original.signIn += 1; return ok },
        signOut: async () => { original.signOut += 1; return { error: null } },
      },
    }
    void originalClient
    const run = async (sign: () => Promise<SignReply>, out: () => Promise<OutReply>, password = 'secret', email = 'owner@example.invalid') => {
      const calls: string[] = []
      const make = (options: TempAuthOptions): TempAuthClient => {
        calls.push('make:' + JSON.stringify(options))
        return {
          auth: {
            signInWithPassword: async (c) => { calls.push('signIn:' + c.email); return sign() },
            signOut: async (o) => { calls.push('signOut:' + o.scope); return out() },
          },
        }
      }
      const result = await verifyOwnerPassword(make, email, UID, password)
      return { result, calls }
    }
    const MAKE = 'make:' + JSON.stringify(TEMP_AUTH_OPTIONS)
    check('A01 separate client options: no persisted session, no refresh, no URL session (createClient, not the cookie client)', TEMP_AUTH_OPTIONS,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    check('A02 correct password: one separate client → sign in → sign out (scope local) BEFORE the result → true',
      await run(async () => ok, async () => ({ error: null })), { result: true, calls: [MAKE, 'signIn:owner@example.invalid', 'signOut:local'] })
    check('A03 wrong password (400, no session): false, no sign out needed',
      await run(async () => ({ data: { user: null, session: null }, error: { status: 400 } }), async () => ({ error: null })), { result: false, calls: [MAKE, 'signIn:owner@example.invalid'] })
    check('A04 other sign-in error (500): not settled (null)',
      await run(async () => ({ data: { user: null, session: null }, error: { status: 500 } }), async () => ({ error: null })), { result: null, calls: [MAKE, 'signIn:owner@example.invalid'] })
    check('A05 signed in as ANOTHER user: the temporary session is still signed out (local), result not settled (null)',
      await run(async () => ({ data: { user: { id: 'someone-else' }, session: { access_token: 't' } }, error: null }), async () => ({ error: null })),
      { result: null, calls: [MAKE, 'signIn:owner@example.invalid', 'signOut:local'] })
    check('A06 sign out returns { error }: not settled (null) — no ticket, no delete',
      await run(async () => ok, async () => ({ error: { message: 'x' } })), { result: null, calls: [MAKE, 'signIn:owner@example.invalid', 'signOut:local'] })
    check('A07 sign out throws: not settled (null)',
      await run(async () => ok, async () => { throw new Error('network') }), { result: null, calls: [MAKE, 'signIn:owner@example.invalid', 'signOut:local'] })
    check('A08 sign in throws: not settled (null), nothing to sign out',
      await run(async () => { throw new Error('network') }, async () => ({ error: null })), { result: null, calls: [MAKE, 'signIn:owner@example.invalid'] })
    check('A09 an error reply that still carries a session: signed out, not settled (null)',
      await run(async () => ({ data: { user: { id: UID }, session: { access_token: 't' } }, error: { status: 400 } }), async () => ({ error: null })),
      { result: null, calls: [MAKE, 'signIn:owner@example.invalid', 'signOut:local'] })
    check('A10 no session and no error: not settled (null)',
      await run(async () => ({ data: { user: { id: UID }, session: null }, error: null }), async () => ({ error: null })), { result: null, calls: [MAKE, 'signIn:owner@example.invalid'] })
    check('A11 empty password or email: no client made at all', [await run(async () => ok, async () => ({ error: null }), ''), await run(async () => ok, async () => ({ error: null }), 'secret', '')],
      [{ result: null, calls: [] }, { result: null, calls: [] }])
    check('A12 the original (browser-session) client is never signed in or out by the adapter', original, { signIn: 0, signOut: 0 })
    {
      const log: Log = []
      const r = await runOrderPurge(req(), steps(log, { verifyPassword: async () => { log.push('verify'); return run(async () => ok, async () => ({ error: { message: 'x' } })).then((x) => x.result) } }))
      check('A13 cleanup not settled inside the real chain: no finish (no ticket), no purge', [r.ok ? null : r.message, log], [ORDER_PURGE_MESSAGES.passwordUnavailable, ['begin', 'verify']])
    }
  }

  return { passed, failures }
}
