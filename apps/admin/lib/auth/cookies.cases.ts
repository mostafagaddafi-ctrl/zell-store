/**
 * COOKIES-HEADERS §٣ — حالات كوكيز جلسة اللوحة على الكوكيز المكتوبة فعليًا (C1–C7).
 *
 * بتشغّل @supabase/ssr الحقيقية (0.5.2) بـ fetch مزيّف (مفيش شبكة ولا Supabase حقيقي) وcookie store مزيّف، عن طريق
 * دوال الكتابة بتاعتنا نفسها: serverCookieMethods + adminAuthCookieOptions (نفس اللي createAuthClient بيمرّره)،
 * وcreateMiddlewareClient وredirectWithCookies (الـ Set-Cookie الحقيقي على رد Next).
 * مشغّل حالات اللوحة بيربط @supabase/ssr وnext من node_modules بتاع اللوحة (suite auth-cookies، link).
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextRequest } from 'next/server'
import { adminAuthCookieOptions, hardenCookieOptions, serverCookieMethods } from './cookieOptions'
import { createMiddlewareClient, redirectWithCookies } from './supabaseMiddleware'

export type AuthCookieCaseFailure = { name: string; expected: string; actual: string }
export type AuthCookieCaseReport = { passed: number; failures: AuthCookieCaseFailure[] }

const SUPABASE_URL = 'https://zellcases.supabase.co'
const ANON_KEY = 'anon-key-for-cases'
const COOKIE_NAME = 'sb-zellcases-auth-token'
const SESSION_NAME = /^sb-zellcases-auth-token(\.\d+)?$/
const MAX_AGE = 400 * 24 * 60 * 60
const ADMIN_ORIGIN = 'https://admin.example.invalid'
const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.invalid',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function jwt(exp: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ sub: USER.id, aud: 'authenticated', role: 'authenticated', exp }))
  return header + '.' + payload + '.c2lnbmF0dXJl'
}

function session(expiresAt: number, refresh: string, note?: string): Record<string, unknown> {
  return {
    access_token: jwt(expiresAt),
    token_type: 'bearer',
    expires_in: expiresAt - nowSeconds(),
    expires_at: expiresAt,
    refresh_token: refresh,
    user: { ...USER, user_metadata: note === undefined ? {} : { note } },
  }
}

type FetchLog = { calls: string[]; unexpected: string[] }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function makeFetch(log: FetchLog, signIn: () => Record<string, unknown>): typeof fetch {
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const call = method + ' ' + url.pathname + url.search
    log.calls.push(call)
    const grant = url.searchParams.get('grant_type')
    if (method === 'POST' && url.pathname === '/auth/v1/token' && grant === 'password') return json(signIn())
    if (method === 'POST' && url.pathname === '/auth/v1/token' && grant === 'refresh_token') return json(session(nowSeconds() + 3600, 'refresh-after'))
    if (method === 'GET' && url.pathname === '/auth/v1/user') return json(USER)
    if (method === 'POST' && url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 })
    log.unexpected.push(call)
    return json({ message: 'unexpected ' + call }, 500)
  }
  return fake as typeof fetch
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

type Written = { name: string; value: string; options: CookieOptions }

function fakeStore() {
  const jar = new Map<string, string>()
  const writes: Written[] = []
  return {
    jar,
    writes,
    getAll() {
      return [...jar].map(([name, value]) => ({ name, value }))
    },
    set(name: string, value: string, options?: CookieOptions) {
      writes.push({ name, value, options: options ?? {} })
      if (options?.maxAge === 0 || value === '') jar.delete(name)
      else jar.set(name, value)
    },
  }
}

type FakeStore = ReturnType<typeof fakeStore>

/** نفس بناء createAuthClient (supabaseServer.ts) بالظبط، بس بـ store مزيّف بدل cookies() من next/headers. */
function serverClient(store: FakeStore) {
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookieOptions: adminAuthCookieOptions(),
    cookies: serverCookieMethods(store),
  })
}

function shape(options: CookieOptions): string {
  return JSON.stringify({
    httpOnly: options.httpOnly ?? null,
    secure: options.secure ?? null,
    sameSite: options.sameSite ?? null,
    path: options.path ?? null,
    maxAge: options.maxAge ?? null,
  })
}

const PROD_SET = shape({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE })
const PROD_DEL = shape({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })

type SetCookie = { name: string; value: string; attrs: Map<string, string> }

function parseSetCookie(line: string): SetCookie {
  const parts = line.split(';').map((part) => part.trim())
  const first = parts[0] ?? ''
  const eq = first.indexOf('=')
  const attrs = new Map<string, string>()
  for (const part of parts.slice(1)) {
    const i = part.indexOf('=')
    attrs.set((i < 0 ? part : part.slice(0, i)).toLowerCase(), i < 0 ? '' : part.slice(i + 1))
  }
  return { name: eq < 0 ? first : first.slice(0, eq), value: eq < 0 ? '' : first.slice(eq + 1), attrs }
}

function setCookies(response: Response): SetCookie[] {
  return response.headers.getSetCookie().map(parseSetCookie)
}

function attrShape(cookie: SetCookie): string {
  return JSON.stringify({
    httpOnly: cookie.attrs.has('httponly'),
    secure: cookie.attrs.has('secure'),
    sameSite: (cookie.attrs.get('samesite') ?? '').toLowerCase(),
    path: cookie.attrs.get('path') ?? null,
    maxAge: cookie.attrs.get('max-age') ?? null,
  })
}

const MW_SET = JSON.stringify({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: String(MAX_AGE) })

function restoreEnv(env: Record<string, string | undefined>, key: string, value: string | undefined): void {
  if (value === undefined) delete env[key]
  else env[key] = value
}

export async function runAuthCookieCases(): Promise<AuthCookieCaseReport> {
  const failures: AuthCookieCaseFailure[] = []
  let passed = 0
  const check = (name: string, expected: string, actual: string) => {
    if (expected === actual) passed += 1
    else failures.push({ name, expected, actual })
  }
  const step = async (name: string, body: () => Promise<void>) => {
    try {
      await body()
    } catch (error) {
      failures.push({ name: name + ' threw', expected: 'no exception', actual: error instanceof Error ? error.message : String(error) })
    }
  }

  const env = process.env as Record<string, string | undefined>
  const saved = { url: env['SUPABASE_URL'], key: env['SUPABASE_ANON_KEY'], node: env['NODE_ENV'] }
  const savedFetch = globalThis.fetch
  // supabase-js بيعمل عميل realtime وقت إنشاء العميل، وrealtime-js بيدوّر على WebSocket ساعتها (Node 20 في CI مفيهوش
  // WebSocket أصلي؛ Edge وNode الأحدث فيهم). مفيش اتصال بيتفتح في الحالات دي، فـ class فاضية كفاية، وبترجع زي ما كانت بعدها.
  const g = globalThis as unknown as Record<string, unknown>
  const hadWebSocket = typeof g['WebSocket'] !== 'undefined'
  const savedWebSocket = g['WebSocket']
  if (!hadWebSocket) g['WebSocket'] = class CasesWebSocket {}
  const log: FetchLog = { calls: [], unexpected: [] }
  let signIn: () => Record<string, unknown> = () => session(nowSeconds() + 3600, 'refresh-1')
  const credentials = { email: USER.email, password: 'cases-password' }

  env['SUPABASE_URL'] = SUPABASE_URL
  env['SUPABASE_ANON_KEY'] = ANON_KEY
  env['NODE_ENV'] = 'production'
  globalThis.fetch = makeFetch(log, () => signIn())

  try {
    await step('C1', async () => {
      const store = fakeStore()
      const result = await serverClient(store).auth.signInWithPassword(credentials)
      await settle()
      check('C1 sign-in ok', 'null', String(result.error?.message ?? null))
      const sets = store.writes.filter((w) => SESSION_NAME.test(w.name) && w.value !== '')
      check('C1 session cookie written', 'true', String(sets.length > 0))
      check('C1 name unchanged (sb-<ref>-auth-token[.n])', 'true', String(sets.length > 0 && sets.every((w) => w.name === COOKIE_NAME || w.name.startsWith(COOKIE_NAME + '.'))))
      for (const w of sets) check('C1 options ' + w.name, PROD_SET, shape(w.options))
      for (const w of store.writes) check('C1 every write hardened ' + w.name, 'true,true,lax', [w.options.httpOnly, w.options.secure, w.options.sameSite].join(','))
    })

    await step('C2+C5', async () => {
      const seed = fakeStore()
      signIn = () => session(nowSeconds() - 120, 'refresh-expired')
      await serverClient(seed).auth.signInWithPassword(credentials)
      await settle()
      signIn = () => session(nowSeconds() + 3600, 'refresh-1')
      const cookieHeader = [...seed.jar].map(([name, value]) => name + '=' + value).join('; ')
      check('C2 expired session cookie seeded', 'true', String(cookieHeader.includes(COOKIE_NAME)))

      const request = new NextRequest(ADMIN_ORIGIN + '/orders', { headers: { cookie: cookieHeader } })
      const before = log.calls.length
      const { supabase, getResponse } = createMiddlewareClient(request, new Headers(request.headers))
      const user = await supabase.auth.getUser()
      await settle()
      const c2Calls = log.calls.slice(before)
      const seeded = seed.jar.get(COOKIE_NAME) ?? ''
      const seededExpiresAt = seeded.startsWith('base64-') ? String((JSON.parse(atob(seeded.slice(7).replace(/-/g, '+').replace(/_/g, '/'))) as { expires_at?: number }).expires_at ?? null) : 'not base64'
      check('C2 refresh call made', 'true', c2Calls.includes('POST /auth/v1/token?grant_type=refresh_token') ? 'true' : 'false; calls=' + JSON.stringify(c2Calls) + '; seeded expires_at=' + seededExpiresAt + '; now=' + String(nowSeconds()))
      check('C2 user after refresh', USER.id, String(user.data.user?.id ?? null))
      const response = getResponse()
      const all = setCookies(response).filter((c) => SESSION_NAME.test(c.name))
      const written = all.filter((c) => c.value !== '')
      check('C2 refreshed cookie on the response', 'true', String(written.length > 0))
      for (const c of written) check('C2 Set-Cookie ' + c.name, MW_SET, attrShape(c))

      const redirect = redirectWithCookies(new URL(ADMIN_ORIGIN + '/login'), response)
      const carried = setCookies(redirect).filter((c) => SESSION_NAME.test(c.name))
      check('C5 redirect carries the same cookies', JSON.stringify(all.map((c) => c.name).sort()), JSON.stringify(carried.map((c) => c.name).sort()))
      for (const c of carried.filter((cookie) => cookie.value !== '')) check('C5 Set-Cookie ' + c.name, MW_SET, attrShape(c))
    })

    await step('C3', async () => {
      const store = fakeStore()
      await serverClient(store).auth.signInWithPassword(credentials)
      await settle()
      const namesBefore = [...store.jar.keys()].filter((name) => SESSION_NAME.test(name)).sort()
      check('C3 signed in before sign-out', 'true', String(namesBefore.length > 0))
      const mark = store.writes.length
      const out = await serverClient(store).auth.signOut()
      await settle()
      check('C3 sign-out ok', 'null', String(out.error?.message ?? null))
      const removals = store.writes.slice(mark).filter((w) => SESSION_NAME.test(w.name))
      check('C3 every session cookie removed', JSON.stringify(namesBefore), JSON.stringify([...new Set(removals.filter((w) => w.options.maxAge === 0).map((w) => w.name))].sort()))
      for (const w of removals) check('C3 removal options ' + w.name, PROD_DEL, shape(w.options))
      check('C3 no session cookie left', '[]', JSON.stringify([...store.jar.keys()].filter((name) => SESSION_NAME.test(name))))
    })

    await step('C4', async () => {
      const store = fakeStore()
      signIn = () => session(nowSeconds() + 3600, 'refresh-big', 'x'.repeat(6000))
      await serverClient(store).auth.signInWithPassword(credentials)
      await settle()
      const chunks = [...store.jar.keys()].filter((name) => name.startsWith(COOKIE_NAME + '.')).sort()
      check('C4 big session is chunked', 'true', String(chunks.length >= 2))
      for (const w of store.writes.filter((x) => SESSION_NAME.test(x.name) && x.value !== '')) check('C4 chunk options ' + w.name, PROD_SET, shape(w.options))
      const mark = store.writes.length
      signIn = () => session(nowSeconds() + 3600, 'refresh-small')
      await serverClient(store).auth.signInWithPassword(credentials)
      await settle()
      check('C4 only the small cookie is left', JSON.stringify([COOKIE_NAME]), JSON.stringify([...store.jar.keys()].filter((name) => SESSION_NAME.test(name)).sort()))
      const removed = store.writes.slice(mark).filter((w) => w.options.maxAge === 0)
      check('C4 old chunks removed', JSON.stringify(chunks), JSON.stringify([...new Set(removed.map((w) => w.name))].filter((name) => name !== COOKIE_NAME).sort()))
      for (const w of removed) check('C4 removal options ' + w.name, PROD_DEL, shape(w.options))
      signIn = () => session(nowSeconds() + 3600, 'refresh-1')
    })

    await step('C6', async () => {
      env['NODE_ENV'] = 'development'
      try {
        const store = fakeStore()
        await serverClient(store).auth.signInWithPassword(credentials)
        await settle()
        const sets = store.writes.filter((w) => SESSION_NAME.test(w.name) && w.value !== '')
        check('C6 dev cookie written', 'true', String(sets.length > 0))
        const devSet = shape({ httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: MAX_AGE })
        for (const w of sets) check('C6 dev options ' + w.name, devSet, shape(w.options))
        check('C6 adminAuthCookieOptions(development)', JSON.stringify({ httpOnly: true, secure: false, sameSite: 'lax', path: '/' }), JSON.stringify(adminAuthCookieOptions('development')))
      } finally {
        env['NODE_ENV'] = 'production'
      }
    })

    await step('C7', async () => {
      const hardened = shape({ httpOnly: true, secure: true, sameSite: 'lax', path: '/p', maxAge: 7 })
      check('C7 harden: library httpOnly false → true', hardened, shape(hardenCookieOptions({ httpOnly: false, secure: false, sameSite: 'none', path: '/p', maxAge: 7 }, 'production')))
      const store = fakeStore()
      serverCookieMethods(store).setAll([{ name: 'probe', value: 'v', options: { httpOnly: false, sameSite: 'none', path: '/p', maxAge: 7 } }])
      const probe = store.writes.find((w) => w.name === 'probe')
      check('C7 serverCookieMethods writes hardened options', hardened, probe ? shape(probe.options) : 'missing')
      const base = adminAuthCookieOptions('production')
      check('C7 cookieOptions has no name and no maxAge', 'false,false', ['name' in base, 'maxAge' in base].join(','))
    })

    check('no unexpected network call', '[]', JSON.stringify(log.unexpected))
  } finally {
    globalThis.fetch = savedFetch
    if (hadWebSocket) g['WebSocket'] = savedWebSocket
    else delete g['WebSocket']
    restoreEnv(env, 'SUPABASE_URL', saved.url)
    restoreEnv(env, 'SUPABASE_ANON_KEY', saved.key)
    restoreEnv(env, 'NODE_ENV', saved.node)
  }

  return { passed, failures }
}
