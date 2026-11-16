/**
 * META-PIXEL §٤-٣ — اختبار متصفح حتمي قبل أي تفعيل (job CI: storefront-pixel-e2e).
 *
 *   PLAYWRIGHT_CORE_DIR=<dir> node apps/storefront/scripts/pixel-e2e/run.mjs
 *
 * بيبني المتجر الحقيقي ويشغّل next start محليًا على مصدر HTTP صناعي (./source.mjs) بدل Supabase، وبيفتح Chrome من غير
 * واجهة بـ playwright-core. مفيش أي مفتاح أو داتا أو رابط Production، ومفيش أي اتصال بميتا (harness.mjs).
 *
 * كل حالة بتطبع PIXEL_CASE <id> pass|fail مع أدلتها، والآخر PIXEL_RESULT. أي دليل ناقص = فشل.
 * فحص عام بعد كل حالة: صفر إرسالات عنوانها محجوب، وصفر قيم PRIVATE_ في سجل السكربت الوهمي والطلبات الخارجية.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASES } from './cases.mjs'
import { ALT_PORT, APP_PORT, ORIGIN, blockedSends, caseStates, chromePath, leaks, loadPlaywright, sleep } from './harness.mjs'
import { createPixelSource } from './source.mjs'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const NEXT_BIN = path.join(APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next')
const SOURCE_PORT = 54339
const READ_KEY = 'pixel-e2e-read-key-not-a-secret'
const SERVICE_KEY = 'pixel-e2e-service-key-not-a-secret'
const REVALIDATE_SECRET = 'pixel-e2e-revalidate-secret-not-a-secret'
const LOG_DIR = process.env['RUNNER_TEMP'] || os.tmpdir()

let source = null
let server = null
let altServer = null

function appEnv() {
  const env = { ...process.env }
  return {
    ...env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    STOREFRONT_DATA_SOURCE: 'supabase',
    SUPABASE_URL: 'http://127.0.0.1:' + String(SOURCE_PORT),
    SUPABASE_READ_KEY: READ_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    REVALIDATE_SECRET,
  }
}

function runNext(args, logName, { detached = false } = {}) {
  const log = createWriteStream(path.join(LOG_DIR, logName))
  const env = appEnv()
  if (!env['SUPABASE_URL'].startsWith('http://127.0.0.1:')) throw new Error('refusing to run: SUPABASE_URL is not the local synthetic source')
  const child = spawn(process.execPath, [NEXT_BIN, ...args], { cwd: APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], detached })
  const tail = []
  const onData = (chunk) => {
    log.write(chunk)
    for (const line of String(chunk).split('\n')) {
      tail.push(line)
      if (tail.length > 300) tail.shift()
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
  return { child, exited, tail }
}

async function build() {
  console.log('PIXEL_STEP build (synthetic source, empty pixel id)')
  const run = runNext(['build'], 'pixel-e2e-next-build.log')
  const { code } = await run.exited
  console.log(run.tail.join('\n'))
  if (code !== 0) throw new Error('next build failed with code ' + String(code))
}

async function startServer() {
  server = runNext(['start', '-p', String(APP_PORT), '-H', '127.0.0.1'], 'pixel-e2e-next-start.log', { detached: true })
  const deadline = Date.now() + 90_000
  for (;;) {
    try {
      await fetch(ORIGIN + '/api/revalidate')
      console.log('PIXEL_STEP server ready')
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
    // ولا حاجة
  }
  await Promise.race([current.exited, sleep(10_000)])
  console.log('PIXEL_STEP next start log tail\n' + current.tail.slice(-60).join('\n'))
}

/** أصل اختبار تاني (P13 ج ود): صفحة فيها لينك للمتجر، و Referrer-Policy من الـ query. */
function startAltServer() {
  altServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const policy = url.searchParams.get('policy') === 'origin' ? 'origin' : 'unsafe-url'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'referrer-policy': policy })
    res.end('<!doctype html><html><body><a id="go" href="' + ORIGIN + '/">store</a></body></html>')
  })
  return new Promise((resolve, reject) => {
    altServer.once('error', reject)
    altServer.listen(ALT_PORT, '127.0.0.1', () => resolve())
  })
}

/** الـ ID في المصدر ← /api/revalidate ← أول طلب للرئيسية بيرجع بالقيمة الجديدة (الدليل في HTML). */
async function applyPixelId(value) {
  source.setPixelId(value)
  const settingsBefore = source.count('/rest/v1/settings')
  const response = await fetch(ORIGIN + '/api/revalidate', { method: 'POST', headers: { 'x-revalidate-secret': REVALIDATE_SECRET } })
  if (response.status !== 200) throw new Error('revalidate failed with ' + String(response.status))
  const valid = /^[0-9]{10,20}$/.test(value.trim())
  const deadline = Date.now() + 30_000
  for (;;) {
    const html = await (await fetch(ORIGIN + '/')).text()
    const shown = html.includes('"pixelId":"' + value.trim() + '"') || html.includes('\\"pixelId\\":\\"' + value.trim() + '\\"')
    const anyValid = /\\?"pixelId\\?":\\?"[0-9]{10,20}\\?"/.test(html)
    // الدليل: المصدر اتقري تاني بعد الإبطال، و HTML الرئيسية فيها الـ ID الجديد (أو مفيهاش أي ID صالح)
    const refetched = source.count('/rest/v1/settings') > settingsBefore
    if (refetched && (valid ? shown : !anyValid)) {
      console.log('PIXEL_STEP pixel id applied ' + JSON.stringify(value))
      return
    }
    if (Date.now() > deadline) throw new Error('pixel id ' + JSON.stringify(value) + ' not applied within 30s')
    await sleep(1000)
  }
}

const results = []

async function runCase(id, body, browser) {
  const failures = []
  const notes = {}
  const expect = (condition, message) => {
    if (!condition) failures.push(message)
  }
  const note = (key, value) => {
    notes[key] = value
  }
  caseStates.length = 0
  const started = Date.now()
  try {
    await body({ browser, expect, note, app: { applyPixelId } })
  } catch (error) {
    failures.push('exception: ' + String(error && error.stack ? error.stack : error))
  }
  // فحص عام لكل حالة (§٤-٣ «نطاق الاختبارات»)
  const blocked = caseStates.flatMap((state) => blockedSends(state))
  const leaked = Array.from(new Set(caseStates.flatMap((state) => leaks(state, ['PRIVATE_']))))
  if (blocked.length > 0) failures.push('sends from a blocked url: ' + JSON.stringify(blocked.map((entry) => entry.href)))
  if (leaked.length > 0) failures.push('PRIVATE_ values in the fake script log or external requests')
  notes['contexts'] = caseStates.length
  notes['externalRequests'] = caseStates.reduce((sum, state) => sum + state.external.length, 0)
  notes['seconds'] = Math.round((Date.now() - started) / 1000)
  const ok = failures.length === 0
  results.push({ id, ok })
  console.log('PIXEL_CASE ' + id + ' ' + (ok ? 'pass' : 'fail') + ' ' + JSON.stringify(ok ? notes : { failures, ...notes }))
}

async function main() {
  if (!existsSync(NEXT_BIN)) throw new Error('next binary not found at ' + NEXT_BIN)
  const { chromium } = loadPlaywright()
  source = createPixelSource({ port: SOURCE_PORT, readKey: READ_KEY, serviceKey: SERVICE_KEY })
  await source.listen()
  source.setPixelId('')
  let browser = null
  try {
    await build()
    await startServer()
    await startAltServer()
    browser = await chromium.launch({ executablePath: chromePath(), headless: true })
    console.log('PIXEL_STEP browser ' + browser.version())
    let current = ''
    for (const [id, body, pixelId] of CASES) {
      if (pixelId !== current) {
        await applyPixelId(pixelId)
        current = pixelId
      }
      await runCase(id, body, browser)
      current = source.pixelId()
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    await stopServer()
    if (altServer) await new Promise((resolve) => altServer.close(() => resolve()))
    console.log('PIXEL_STEP synthetic source requests ' + String(source.total()))
    await source.close()
  }

  const expected = CASES.map(([id]) => id)
  const seen = results.map((result) => result.id)
  const missing = expected.filter((id) => !seen.includes(id))
  const pass = results.filter((result) => result.ok).length
  const fail = results.length - pass + missing.length
  console.log('PIXEL_RESULT pass=' + String(pass) + ' fail=' + String(fail) + (missing.length ? ' missing=' + missing.join(',') : ''))
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error('PIXEL_FATAL ' + String(error && error.stack ? error.stack : error))
  await stopServer().catch(() => {})
  process.exit(1)
})
