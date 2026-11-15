/**
 * PRODUCT-ISR §٢-٢ و§٤ — اختبار تكامل معزول لكاش استجابة صفحة المنتج (ISR).
 *
 * بيبني المتجر ويشغّل next start محليًا على مصدر HTTP صناعي (./source.mjs) بدل Supabase،
 * وبينادي إندبوينت التجديد الحقيقي (/api/revalidate) بمفتاح اختبار. مفيش أي مفتاح أو داتا أو رابط Production.
 *
 *   node apps/storefront/scripts/isr-integration/run.mjs core          T1 · T2 · T3 · T4 · T6a · T6c
 *   node apps/storefront/scripts/isr-integration/run.mjs time          T5  (تجديد زمني، مصدر شغّال)
 *   node apps/storefront/scripts/isr-integration/run.mjs time-failure  T6b (فشل زمني من غير إبطال)
 *
 * كل حالة بتطبع ISR_CASE <id> pass|fail مع الأدلة، وكل طلب بيطبع ISR_LOG، والآخر ISR_RESULT.
 * أي دليل ناقص = فشل صريح. حدود الانتظار هنا للاختبار بس، مش سقف للإنتاج (العقد §٣-١).
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSyntheticSource } from './source.mjs'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const NEXT_BIN = path.join(APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next')
const FETCH_CACHE_DIR = path.join(APP_DIR, '.next', 'cache', 'fetch-cache')
const SOURCE_PORT = 54329
const APP_PORT = 3107
const ORIGIN = 'http://127.0.0.1:' + String(APP_PORT)
const READ_KEY = 'isr-integration-read-key-not-a-secret'
const REVALIDATE_SECRET = 'isr-integration-revalidate-secret-not-a-secret'
const TARGET_SECONDS = 300
const LOG_DIR = process.env['RUNNER_TEMP'] || os.tmpdir()
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) zell-isr-integration'

const PRICE = { A: 37100, B: 48300, C: 59900, P2: 21700, P900: 64100, P950: 73300 }
const EXPECTED_CASES = { core: ['T1', 'T2', 'T3', 'T4', 'T6a', 'T6c'], time: ['T5'], 'time-failure': ['T6b'] }

const startedAt = Date.now()
const elapsed = () => Math.round((Date.now() - startedAt) / 100) / 10
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sleepUntil = async (timestamp) => {
  const wait = timestamp - Date.now()
  if (wait > 0) await sleep(wait)
}

// ── شكل السعر زي formatPiastres (أرقام لاتينية) و Num (أرقام عربية في الصفحة) ──
const pounds = (piastres) => String(piastres / 100) + ' ج.م'
const arabicDigits = (text) => text.replace(/[0-9]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.charAt(Number(digit)))
const hasPrice = (body, piastres) => body.includes('>' + arabicDigits(pounds(piastres)) + '<')
const priceLine = (piastres) => 'السعر ' + pounds(piastres) + ' للمتر'

/** سعر منتج 1 في الـ HTML: A أو B أو C، و none لو مفيش، و mixed لو أكتر من واحد. */
function priceOf(body) {
  const found = ['A', 'B', 'C'].filter((key) => hasPrice(body, PRICE[key]))
  if (found.length === 1) return found[0]
  return found.length === 0 ? 'none' : 'mixed'
}

function titleOf(body) {
  const match = /<title>([^<]*)<\/title>/.exec(body)
  return match ? match[1] : null
}

/** قيم content لكل <meta> اسمه أو property بتاعه = key. */
function metaValues(body, key) {
  const values = []
  for (const tag of body.matchAll(/<meta\s+([^>]*?)\/?>/g)) {
    const attrs = {}
    for (const attr of tag[1].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[attr[1]] = attr[2]
    if ((attrs['name'] === key || attrs['property'] === key) && typeof attrs['content'] === 'string') values.push(attrs['content'])
  }
  return values
}

// ── HTTP ──
async function request(urlPath, init = {}) {
  const response = await fetch(ORIGIN + urlPath, {
    redirect: 'manual',
    ...init,
    headers: { 'user-agent': USER_AGENT, ...(init.headers || {}) },
  })
  const body = await response.text()
  return {
    status: response.status,
    cache: response.headers.get('x-nextjs-cache'),
    cacheControl: response.headers.get('cache-control'),
    body,
  }
}

async function revalidate(secret) {
  const response = await request('/api/revalidate', { method: 'POST', headers: { 'x-revalidate-secret': secret } })
  let json = null
  try {
    json = JSON.parse(response.body)
  } catch {
    json = null
  }
  return { ...response, json }
}

const revalidated = (response) => response.status === 200 && response.json !== null && response.json.ok === true

let source = null

function sample(label, response, extra = {}) {
  const row = {
    t: elapsed(),
    label,
    status: response.status,
    cache: response.cache,
    cacheControl: response.cacheControl,
    price: priceOf(response.body),
    sourceTotal: source ? source.total() : null,
    ...extra,
  }
  console.log('ISR_LOG ' + JSON.stringify(row))
  return row
}

/** طلبات كل intervalMs لحد ما predicate يتحقق أو الموعد يعدّي (حد للاختبار بس). */
async function pollUntil(label, urlPath, predicate, deadline, intervalMs = 5000) {
  const rows = []
  const begin = Date.now()
  for (;;) {
    const response = await request(urlPath)
    const row = sample(label + ' #' + String(rows.length + 1), response)
    rows.push(row)
    if (predicate(response)) return { ok: true, rows, at: Date.now(), seconds: Math.round((Date.now() - begin) / 1000) }
    if (Date.now() + intervalMs > deadline) return { ok: false, rows, at: Date.now(), seconds: Math.round((Date.now() - begin) / 1000) }
    await sleep(intervalMs)
  }
}

// ── الحالات ──
const results = []

async function runCase(id, body) {
  const failures = []
  const notes = {}
  const expect = (condition, message) => {
    if (!condition) failures.push(message)
  }
  const note = (key, value) => {
    notes[key] = value
  }
  try {
    await body({ expect, note })
  } catch (error) {
    failures.push('exception: ' + String(error && error.stack ? error.stack : error))
  }
  const ok = failures.length === 0
  results.push({ id, ok })
  console.log('ISR_CASE ' + id + ' ' + (ok ? 'pass' : 'fail') + ' ' + JSON.stringify(ok ? notes : { failures, ...notes }))
}

// ── تشغيل Next ──
function appEnv() {
  const env = { ...process.env }
  delete env['SUPABASE_SERVICE_ROLE_KEY']
  return {
    ...env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    STOREFRONT_DATA_SOURCE: 'supabase',
    SUPABASE_URL: 'http://127.0.0.1:' + String(SOURCE_PORT),
    SUPABASE_READ_KEY: READ_KEY,
    REVALIDATE_SECRET,
  }
}

function runNext(args, logName, { detached = false } = {}) {
  const logPath = path.join(LOG_DIR, logName)
  const log = createWriteStream(logPath)
  const env = appEnv()
  if (!env['SUPABASE_URL'].startsWith('http://127.0.0.1:')) throw new Error('refusing to run: SUPABASE_URL is not the local synthetic source')
  const child = spawn(process.execPath, [NEXT_BIN, ...args], { cwd: APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], detached })
  const tail = []
  const onData = (chunk) => {
    log.write(chunk)
    for (const line of String(chunk).split('\n')) {
      tail.push(line)
      if (tail.length > 400) tail.shift()
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
  return { child, exited, tail, logPath }
}

async function build() {
  console.log('ISR_STEP build (synthetic source, STOREFRONT_DATA_SOURCE=supabase)')
  const run = runNext(['build'], 'isr-next-build.log')
  const { code } = await run.exited
  console.log(run.tail.join('\n'))
  if (code !== 0) throw new Error('next build failed with code ' + String(code))
}

let server = null

async function startServer(logName) {
  server = runNext(['start', '-p', String(APP_PORT), '-H', '127.0.0.1'], logName, { detached: true })
  const deadline = Date.now() + 90_000
  for (;;) {
    try {
      // أي رد = السيرفر جاهز. /api/revalidate بـ GET مابيقراش أي داتا.
      await fetch(ORIGIN + '/api/revalidate', { headers: { 'user-agent': USER_AGENT } })
      console.log('ISR_STEP server ready (' + logName + ')')
      return
    } catch {
      if (Date.now() > deadline) throw new Error('next start not ready within 90s')
      await sleep(500)
    }
  }
}

async function stopServer() {
  if (!server) return
  const current = server
  server = null
  try {
    process.kill(-current.child.pid, 'SIGTERM')
  } catch {
    // already gone
  }
  const done = await Promise.race([current.exited, sleep(10_000).then(() => null)])
  if (done === null) {
    try {
      process.kill(-current.child.pid, 'SIGKILL')
    } catch {
      // already gone
    }
    await current.exited
  }
  const errors = current.tail.filter((line) => line.trim() !== '').slice(-150)
  console.log('ISR_STEP server stopped — last log lines:\n' + errors.join('\n'))
}

// ── المجموعات ──
async function groupCore() {
  await runCase('T1', async ({ expect, note }) => {
    const c0 = source.total()
    const first = await request('/product/1')
    const c1 = source.total()
    sample('T1 first', first)
    const second = await request('/product/1')
    const c2 = source.total()
    sample('T1 second', second)
    note('firstCache', first.cache)
    note('secondCache', second.cache)
    note('sourceRequestsFirst', c1 - c0)
    note('sourceRequestsSecond', c2 - c1)
    expect(first.status === 200, 'first status ' + String(first.status))
    expect(priceOf(first.body) === 'A', 'first response price is ' + priceOf(first.body) + ', expected A')
    expect(second.status === 200, 'second status ' + String(second.status))
    expect(second.body === first.body, 'second HTML differs from the first')
    expect(c2 === c1, 'second request reached the synthetic source (' + String(c2 - c1) + ' requests)')
    expect(second.cache === 'HIT', 'second x-nextjs-cache = ' + String(second.cache) + ', expected HIT')
  })

  await runCase('T2', async ({ expect, note }) => {
    const response = await request('/product/1')
    sample('T2', response)
    const cacheControl = (response.cacheControl || '').toLowerCase()
    note('cacheControl', response.cacheControl)
    expect(cacheControl !== '', 'no Cache-Control header')
    expect(!/\bprivate\b/.test(cacheControl), 'Cache-Control has private: ' + cacheControl)
    expect(!/\bno-store\b/.test(cacheControl), 'Cache-Control has no-store: ' + cacheControl)
    const parts = cacheControl.split(',').map((part) => part.trim())
    expect(parts.includes('s-maxage=' + String(TARGET_SECONDS)), 's-maxage is not exactly ' + String(TARGET_SECONDS) + ': ' + cacheControl)
  })

  await runCase('T3', async ({ expect, note }) => {
    const NEW_NAME = 'منتج اختبار 1 بعد التعديل'
    source.updateProduct(1, { price_per_meter_piastres: PRICE.B, name_ar: NEW_NAME })
    const before = await request('/product/1')
    sample('T3 changed, before revalidate', before)
    expect(before.status === 200 && priceOf(before.body) === 'A', 'before revalidate: expected cached A, got ' + String(before.status) + ' ' + priceOf(before.body))

    const wrong = await revalidate('wrong-secret')
    sample('T3 wrong secret', wrong)
    expect(wrong.status === 401, 'wrong secret status ' + String(wrong.status) + ', expected 401')
    const afterWrong = await request('/product/1')
    sample('T3 after wrong secret', afterWrong)
    expect(priceOf(afterWrong.body) === 'A', 'wrong secret changed the page: ' + priceOf(afterWrong.body))

    const ok = await revalidate(REVALIDATE_SECRET)
    sample('T3 revalidate', ok)
    expect(revalidated(ok), 'revalidate did not return 200 ok:true (' + String(ok.status) + ')')

    const after = await request('/product/1')
    sample('T3 first after revalidate', after)
    note('firstAfterRevalidateCache', after.cache)
    expect(after.status === 200, 'first after revalidate status ' + String(after.status))
    expect(priceOf(after.body) === 'B', 'first after revalidate HTML price is ' + priceOf(after.body) + ', expected B')
    const title = titleOf(after.body)
    note('title', title)
    expect(title !== null && title.startsWith(NEW_NAME + ' · '), 'title not updated: ' + String(title))
    const description = metaValues(after.body, 'description')
    note('description', description)
    expect(description.includes(priceLine(PRICE.B)) && !description.includes(priceLine(PRICE.A)), 'meta description not updated to B')
    const ogDescription = metaValues(after.body, 'og:description')
    note('ogDescription', ogDescription)
    expect(ogDescription.includes(priceLine(PRICE.B)) && !ogDescription.includes(priceLine(PRICE.A)), 'og:description not updated to B')
    const ogTitle = metaValues(after.body, 'og:title')
    note('ogTitle', ogTitle)
    expect(ogTitle.some((value) => value.startsWith(NEW_NAME)), 'og:title not updated')
  })

  await runCase('T4', async ({ expect, note }) => {
    const unknown = await request('/product/900')
    sample('T4 unknown id', unknown)
    note('notFoundCache', unknown.cache)
    note('notFoundCacheControl', unknown.cacheControl)
    expect(unknown.status === 404, 'unknown id status ' + String(unknown.status) + ', expected 404')

    source.addProduct(900, PRICE.P900)
    const addedBefore = await request('/product/900')
    sample('T4 added, before revalidate', addedBefore)
    note('addedBeforeRevalidateStatus', addedBefore.status)
    const rv1 = await revalidate(REVALIDATE_SECRET)
    sample('T4 revalidate after add', rv1)
    expect(revalidated(rv1), 'revalidate after add failed (' + String(rv1.status) + ')')
    const added = await request('/product/900')
    sample('T4 first after add + revalidate', added)
    expect(added.status === 200 && hasPrice(added.body, PRICE.P900), 'after add + revalidate: expected 200 with its price, got ' + String(added.status))

    source.updateProduct(900, { is_active: false })
    const rv2 = await revalidate(REVALIDATE_SECRET)
    sample('T4 revalidate after hide', rv2)
    expect(revalidated(rv2), 'revalidate after hide failed (' + String(rv2.status) + ')')
    const hidden = await request('/product/900')
    sample('T4 first after hide + revalidate', hidden)
    expect(hidden.status === 404, 'after hide + revalidate status ' + String(hidden.status) + ', expected 404')
  })

  // §٣-٣ مسار الإبطال (قرار المالك 2026-11-15، العقد §٦ بند ٧): بعد POST /api/revalidate والمصدر واقع
  // = خطأ مش متكاش، وكل طلب بيعيد محاولة الجلب فعلًا (عدّاد المصدر)، والرجوع بأحدث نسخة من أول طلب بعد عودة المصدر.
  // المسار الزمني (T6b) ماتغيّرش: آخر نسخة ناجحة تفضل ظاهرة.
  await runCase('T6a', async ({ expect, note }) => {
    const warm = await request('/product/1')
    sample('T6a warm', warm)
    expect(warm.status === 200 && priceOf(warm.body) === 'B', 'warm: expected last successful B, got ' + String(warm.status) + ' ' + priceOf(warm.body))

    source.updateProduct(1, { price_per_meter_piastres: PRICE.C })
    source.setFailing(true)
    const rv = await revalidate(REVALIDATE_SECRET)
    sample('T6a revalidate while source fails', rv)
    expect(revalidated(rv), 'revalidate failed (' + String(rv.status) + ')')

    const during = []
    for (let i = 0; i < 6; i += 1) {
      const before = source.total()
      const response = await request('/product/1')
      during.push(sample('T6a during failure #' + String(i + 1), response, { sourceAttempts: source.total() - before }))
      if (i < 5) await sleep(5000)
    }
    note('duringFailure', during.map((row) => [row.status, row.cache, row.cacheControl, row.sourceAttempts]))
    expect(
      during.every((row) => row.status >= 500),
      'policy §٣-٣ (invalidation path): expected an error response on every request while the source is down',
    )
    expect(
      during.every((row) => row.sourceAttempts > 0),
      'error looks cached: a request during the failure did not reach the source',
    )
    expect(
      during.every((row) => !/s-maxage/i.test(row.cacheControl || '')),
      'error response is cacheable (s-maxage present)',
    )

    source.setFailing(false)
    const recovered = await request('/product/1')
    sample('T6a first request after source recovery', recovered)
    note('firstAfterRecovery', [recovered.status, recovered.cache, priceOf(recovered.body)])
    expect(
      recovered.status === 200 && priceOf(recovered.body) === 'C',
      'first request after source recovery: expected 200 with the newest price C, got ' + String(recovered.status) + ' ' + priceOf(recovered.body),
    )
  })

  await runCase('T6c', async ({ expect, note }) => {
    await stopServer()
    await rm(FETCH_CACHE_DIR, { recursive: true, force: true })
    source.addProduct(950, PRICE.P950)
    source.setFailing(true)
    await startServer('isr-next-start-t6c.log')

    const c0 = source.total()
    const first = await request('/product/950')
    const c1 = source.total()
    sample('T6c first (no page cache, no data cache, source down)', first)
    note('preconditionSourceAttempts', c1 - c0)
    note('firstStatus', first.status)
    note('firstCacheControl', first.cacheControl)
    if (c1 - c0 === 0) {
      expect(false, 'precondition not met: the request did not reach the source (a valid cache existed)')
      return
    }
    expect(first.status >= 500, 'first status ' + String(first.status) + ', expected an error (5xx)')

    const second = await request('/product/950')
    const c2 = source.total()
    sample('T6c second (source still down)', second)
    note('secondSourceAttempts', c2 - c1)
    expect(c2 - c1 > 0, 'error looks cached: the second request did not reach the source')
    expect(second.status >= 500, 'second status ' + String(second.status) + ', expected an error (5xx)')

    source.setFailing(false)
    const recovered = await request('/product/950')
    sample('T6c after source recovery', recovered)
    expect(recovered.status === 200 && hasPrice(recovered.body, PRICE.P950), 'after recovery: expected 200 with its price, got ' + String(recovered.status))
  })
}

async function groupTime() {
  await runCase('T5', async ({ expect, note }) => {
    const c0 = source.total()
    const warm = await request('/product/1')
    const t0 = Date.now()
    sample('T5 warm', warm)
    note('warmSourceRequests', source.total() - c0)
    expect(warm.status === 200 && priceOf(warm.body) === 'A', 'warm: expected A, got ' + String(warm.status) + ' ' + priceOf(warm.body))

    source.updateProduct(1, { price_per_meter_piastres: PRICE.B })
    await sleepUntil(t0 + 240_000)
    const early = await request('/product/1')
    sample('T5 at ~240s (before target)', early)
    expect(early.status === 200 && priceOf(early.body) === 'A', 'before 300s: expected old A, got ' + String(early.status) + ' ' + priceOf(early.body))

    await sleepUntil(t0 + (TARGET_SECONDS + 5) * 1000)
    const deadline = t0 + 900_000
    const result = await pollUntil('T5 after target', '/product/1', (r) => r.status === 200 && priceOf(r.body) === 'B', deadline)
    const first = result.rows[0]
    note('secondsFromWarmToNew', Math.round((result.at - t0) / 1000))
    note('requestsAfterTarget', result.rows.length)
    note('firstAfterTarget', first ? [first.status, first.cache, first.price] : null)
    note('afterTarget', result.rows.map((row) => [row.t, row.status, row.cache, row.price]))
    expect(result.rows.every((row) => row.status === 200), 'an error response appeared while the source was healthy')
    expect(result.ok, 'new price B did not appear within the 900s test bound (test bound only, not a production cap)')
  })
}

async function groupTimeFailure() {
  await runCase('T6b', async ({ expect, note }) => {
    const warm = await request('/product/1')
    const t0 = Date.now()
    sample('T6b warm', warm)
    expect(warm.status === 200 && priceOf(warm.body) === 'A', 'warm: expected A, got ' + String(warm.status) + ' ' + priceOf(warm.body))

    await sleepUntil(t0 + 270_000)
    source.setFailing(true)
    const cFail = source.total()
    console.log('ISR_STEP T6b source failing from t=' + String(elapsed()) + 's (no /api/revalidate call)')

    await sleepUntil(t0 + (TARGET_SECONDS + 5) * 1000)
    const during = []
    const failureEnd = Date.now() + 90_000
    while (Date.now() < failureEnd) {
      during.push(sample('T6b after target, source down #' + String(during.length + 1), await request('/product/1')))
      await sleep(5000)
    }
    const attempts = source.total() - cFail
    note('sourceAttemptsDuringFailure', attempts)
    note('duringFailure', during.map((row) => [row.t, row.status, row.cache, row.price]))
    expect(attempts > 0, 'no refetch attempt after the target duration: the time-based path was not exercised')
    expect(
      during.every((row) => row.status === 200 && row.price === 'A'),
      'policy §٣-٣: last successful version (A) must stay visible with no error during a time-based failure',
    )

    source.setFailing(false)
    source.updateProduct(1, { price_per_meter_piastres: PRICE.B })
    const recovery = await pollUntil('T6b recovery', '/product/1', (r) => r.status === 200 && priceOf(r.body) === 'B', Date.now() + 420_000)
    note('recoverySeconds', recovery.seconds)
    note('recovery', recovery.rows.map((row) => [row.t, row.status, row.cache, row.price]))
    expect(recovery.rows.every((row) => row.status === 200), 'an error response appeared during recovery')
    expect(recovery.ok, 'no recovery to B within the 420s test bound (test bound only)')
  })
}

const GROUPS = { core: groupCore, time: groupTime, 'time-failure': groupTimeFailure }

async function main() {
  const group = process.argv[2] || ''
  const runGroup = GROUPS[group]
  if (!runGroup) {
    console.error('usage: run.mjs core|time|time-failure')
    process.exit(2)
  }
  if (!existsSync(NEXT_BIN)) throw new Error('next binary not found at ' + NEXT_BIN)

  source = createSyntheticSource({ port: SOURCE_PORT, readKey: READ_KEY })
  await source.listen()
  source.addProduct(1, PRICE.A)
  source.addProduct(2, PRICE.P2)

  try {
    await build()
    // كل مجموعة بتبدأ من غير Data Cache من البناء، علشان أعمار الداتا تبقى معروفة.
    await rm(FETCH_CACHE_DIR, { recursive: true, force: true })
    await startServer('isr-next-start.log')
    await runGroup()
  } finally {
    await stopServer()
    console.log('ISR_STEP synthetic source requests per table ' + JSON.stringify(source.perTable()))
    await source.close()
  }

  const expected = EXPECTED_CASES[group]
  const seen = results.map((result) => result.id)
  const missing = expected.filter((id) => !seen.includes(id))
  const pass = results.filter((result) => result.ok).length
  const fail = results.length - pass + missing.length
  console.log('ISR_RESULT group=' + group + ' pass=' + String(pass) + ' fail=' + String(fail) + (missing.length ? ' missing=' + missing.join(',') : ''))
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error('ISR_FATAL ' + String(error && error.stack ? error.stack : error))
  try {
    await stopServer()
  } catch {
    // ignore
  }
  console.log('ISR_RESULT group=' + String(process.argv[2]) + ' pass=0 fail=1 fatal=1')
  process.exit(1)
})
