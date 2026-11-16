/**
 * META-PIXEL §٤-٣ — أدوات اختبار المتصفح (storefront-pixel-e2e): المتصفح والسياقات واعتراض الطلبات والسجل.
 *
 * 🔒 مفيش أي اتصال بميتا ولا بأي حاجة برّه: كل طلب لغير السيرفر المحلي (المتجر وأصل الاختبار التاني) بيتقفل ويتسجّل،
 *    ماعدا https://connect.facebook.net/en_US/fbevents.js اللي بيترد عليه بالسكربت الوهمي (fake-fbevents.js).
 * 🔒 POST /api/orders بيترد عليه من الاختبار نفسه في المتصفح (مابيوصلش للسيرفر)، وكود CheckoutForm هو اللي بيشتغل.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const APP_PORT = 3117
export const ALT_PORT = 3118
export const ORIGIN = 'http://127.0.0.1:' + String(APP_PORT)
export const ALT_ORIGIN = 'http://127.0.0.1:' + String(ALT_PORT)
export const SDK_SRC = 'https://connect.facebook.net/en_US/fbevents.js'
export const HOLD_PATH = '/__pixel_e2e_hold.png'
export const DESKTOP = { width: 1280, height: 900 }
export const MOBILE = { width: 390, height: 844 }
export const ORDER_NUMBER = 'FLM-PZQXWK'
export const CART_PIECE = [{ id: 'pixel-e2e-line', productId: 2, lengthCm: 0, quantity: 1 }]

const FAKE_TEMPLATE = readFileSync(path.join(HERE, 'fake-fbevents.js'), 'utf8')
const CONFIG_MARK = '/*__PIXEL_E2E_CONFIG__*/ null'
if (!FAKE_TEMPLATE.includes(CONFIG_MARK)) throw new Error('fake-fbevents.js: config mark not found')

// صورة PNG شفافة 1×1
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitFor(predicate, timeoutMs, label, stepMs = 100) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error('timeout (' + String(timeoutMs) + 'ms): ' + label)
    await sleep(stepMs)
  }
}

export function loadPlaywright() {
  const dir = (process.env['PLAYWRIGHT_CORE_DIR'] || '').trim()
  if (dir === '') throw new Error('PLAYWRIGHT_CORE_DIR is not set (the CI job installs a pinned playwright-core there)')
  const require = createRequire(path.join(dir, 'package.json'))
  return require('playwright-core')
}

export function chromePath() {
  return (process.env['PIXEL_E2E_CHROME'] || '/usr/bin/google-chrome').trim()
}

export function isBlockedPathname(pathname) {
  const p = String(pathname).toLowerCase()
  return p === '/order' || p.startsWith('/order/') || p === '/track' || p.startsWith('/track/')
}

function pathnameOf(href) {
  try {
    return new URL(href).pathname
  } catch {
    return ''
  }
}

/** سكربت بيتحقن في كل مستند قبل سكربتات الصفحة: رقم المستند والتسلسل وسجل replaceState وإضافة عنصر السكربت. */
function initScript(options) {
  const cart = options.cart ? JSON.stringify(options.cart) : null
  return (
    '(' +
    function (holdImage, holdPath, cartJson) {
      if (window.top !== window) return
      var docId = Math.random().toString(36).slice(2) + Date.now().toString(36)
      var seq = 0
      Object.defineProperty(window, '__pixelE2eDocId', { value: docId })
      var log = function (entry) {
        seq += 1
        entry.docId = docId
        entry.seq = seq
        entry.t = performance.now()
        try {
          if (typeof window.__pixelE2eReport === 'function') window.__pixelE2eReport(entry)
        } catch (e) {
          // ولا حاجة
        }
      }
      Object.defineProperty(window, '__pixelE2eLog', { value: log })
      log({ type: 'doc', href: location.href, referrer: document.referrer })

      try {
        if (cartJson && !window.localStorage.getItem('__pixel_e2e_seeded')) {
          window.localStorage.setItem('zell-cart-v2', cartJson)
          window.localStorage.setItem('__pixel_e2e_seeded', '1')
        }
      } catch (e) {
        // ولا حاجة
      }

      var originalReplace = history.replaceState
      history.replaceState = function () {
        var result = originalReplace.apply(this, arguments)
        log({ type: 'replaceState', url: arguments.length > 2 && arguments[2] != null ? String(arguments[2]) : null, href: location.href })
        return result
      }

      var originalAppend = Node.prototype.appendChild
      Node.prototype.appendChild = function (child) {
        try {
          if (child && child.tagName === 'SCRIPT' && String(child.src).indexOf('connect.facebook.net') >= 0) {
            var nav = performance.getEntriesByType('navigation')[0]
            log({ type: 'sdk-append', href: location.href, src: String(child.src), loadEventEnd: nav ? nav.loadEventEnd : null })
          }
        } catch (e) {
          // ولا حاجة
        }
        return originalAppend.apply(this, arguments)
      }

      if (holdImage) {
        document.addEventListener('DOMContentLoaded', function () {
          var img = new Image(1, 1)
          img.alt = ''
          img.src = holdPath
          document.body.appendChild(img)
        })
      }
    }.toString() +
    ')(' +
    JSON.stringify(options.holdImage === true) +
    ',' +
    JSON.stringify(HOLD_PATH) +
    ',' +
    JSON.stringify(cart) +
    ')'
  )
}

export function fakeScript(config) {
  return FAKE_TEMPLATE.replace(CONFIG_MARK, JSON.stringify(config || {}))
}

export function orderBody(replayed) {
  return {
    ok: true,
    order: {
      orderNumber: ORDER_NUMBER,
      subtotalPiastres: 21700,
      shippingPiastres: 5000,
      totalPiastres: 26700,
      installationPiastres: 0,
      installationTravelPiastres: 0,
      couponCode: null,
      discountPiastres: 0,
      replayed,
    },
  }
}

async function handleRoute(route, state) {
  const request = route.request()
  const url = request.url()
  let parsed = null
  try {
    parsed = new URL(url)
  } catch {
    parsed = null
  }
  const record = () => {
    state.external.push({ url, method: request.method(), headers: request.headers(), body: request.postData() || '' })
  }

  if (url === SDK_SRC) {
    record()
    state.sdkRequests.push({ at: Date.now(), headers: request.headers() })
    const fake = state.fake
    if (fake.delayMs) await sleep(fake.delayMs)
    try {
      if (fake.status && fake.status !== 200) await route.fulfill({ status: fake.status, contentType: 'text/plain', body: 'synthetic failure' })
      else await route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeScript(fake) })
    } catch {
      // الصفحة اتقفلت قبل الرد
    }
    return
  }

  if (parsed && (parsed.origin === ORIGIN || parsed.origin === ALT_ORIGIN)) {
    if (parsed.origin === ORIGIN && parsed.pathname === HOLD_PATH) {
      if (!state.released) await new Promise((resolve) => state.holds.push(resolve))
      try {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 })
      } catch {
        // ولا حاجة
      }
      return
    }
    if (parsed.origin === ORIGIN && parsed.pathname === '/api/orders' && request.method() === 'POST') {
      state.orders.push(request.postData() || '')
      try {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(orderBody(state.replayed === true)) })
      } catch {
        // ولا حاجة
      }
      return
    }
    try {
      await route.continue()
    } catch {
      // ولا حاجة
    }
    return
  }

  record()
  try {
    await route.abort('blockedbyclient')
  } catch {
    // ولا حاجة
  }
}

/** كل الـ states اللي اتفتحت في الحالة الحالية (للفحوص العامة في آخر كل حالة). */
export const caseStates = []

export async function openContext(browser, options = {}) {
  const state = {
    entries: [],
    external: [],
    sdkRequests: [],
    orders: [],
    pageErrors: [],
    holds: [],
    released: false,
    replayed: false,
    fake: { ...(options.fake || {}) },
  }
  caseStates.push(state)
  const context = await browser.newContext({ viewport: options.viewport || DESKTOP, serviceWorkers: 'block', locale: 'ar-EG' })
  await context.exposeBinding('__pixelE2eReport', (_source, entry) => {
    state.entries.push(entry)
  })
  await context.addInitScript({ content: initScript(options) })
  await context.route('**/*', (route) => handleRoute(route, state))
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    state.pageErrors.push(String(error && error.message ? error.message : error))
  })
  state.release = () => {
    state.released = true
    for (const resolve of state.holds.splice(0)) resolve()
  }
  return { context, page, state }
}

// ── قراية السجل ──
export const docOf = (page) => page.evaluate(() => window.__pixelE2eDocId || null)
export const ofDoc = (state, docId, type) => state.entries.filter((entry) => entry.docId === docId && entry.type === type)
export const calls = (state, docId) => ofDoc(state, docId, 'fake-call')
export const inits = (state, docId) => calls(state, docId).filter((entry) => Array.isArray(entry.args) && entry.args[0] === 'init')
export const tracks = (state, docId, name) =>
  calls(state, docId).filter((entry) => Array.isArray(entry.args) && entry.args[0] === 'track' && (name === undefined || entry.args[1] === name))
export const sends = (state) => state.entries.filter((entry) => entry.type === 'fake-send')
export const blockedSends = (state) => sends(state).filter((entry) => isBlockedPathname(pathnameOf(entry.href)))
export const docEntry = (state, docId) => ofDoc(state, docId, 'doc')[0] || null

/** أي قيمة من markers في سجل السكربت الوهمي (params والعنوان والـ referrer) أو في أي طلب خارجي (العنوان والـ body والهيدرز). */
export function leaks(state, markers) {
  const text = JSON.stringify({
    fake: state.entries.filter((entry) => String(entry.type).startsWith('fake-')),
    external: state.external,
  })
  return markers.filter((marker) => text.includes(marker))
}

export async function waitForSdkAppend(state, docId, timeoutMs = 15000) {
  return waitFor(() => ofDoc(state, docId, 'sdk-append')[0], timeoutMs, 'sdk script append')
}

export async function waitForInit(state, docId, timeoutMs = 15000) {
  return waitFor(() => inits(state, docId)[0], timeoutMs, 'fbq init')
}

export async function waitForArmed(page, timeoutMs = 15000) {
  return waitFor(
    () =>
      page.evaluate(() => {
        const boot = window.__zellPixelBoot
        return Boolean(boot && boot.bridge && typeof boot.bridge.isArmed === 'function' && boot.bridge.isArmed())
      }),
    timeoutMs,
    'pixel armed',
    200,
  )
}

/** تنقل داخلي (نفس المستند) بـ router بتاع Next — بيفشل لو المستند اتبدّل. */
export async function internalNav(page, href) {
  const before = await docOf(page)
  const used = await page.evaluate((target) => {
    const router = window.next && window.next.router
    if (router && typeof router.push === 'function') {
      router.push(target)
      return true
    }
    return false
  }, href)
  if (!used) throw new Error('window.next.router.push is not available')
  await page.waitForFunction((target) => location.pathname + location.search === target, href, { timeout: 15000 })
  await sleep(800)
  const after = await docOf(page)
  if (after !== before) throw new Error('internal navigation to ' + href + ' replaced the document')
}

export async function routerRefresh(page) {
  const used = await page.evaluate(() => {
    const router = window.next && window.next.router
    if (router && typeof router.refresh === 'function') {
      router.refresh()
      return true
    }
    return false
  })
  if (!used) throw new Error('window.next.router.refresh is not available')
}

/** فورم الـ Checkout بقيم الحالة ثم «تأكيد الطلب» — الرد من handleRoute. */
export async function submitOrder(page, state, customer, { replayed = false } = {}) {
  state.replayed = replayed
  await page.waitForSelector('#name', { timeout: 20000 })
  await page.evaluate(() => {
    window.__pixelE2eMark = 'checkout'
  })
  const before = await docOf(page)
  await page.fill('#name', customer.name)
  await page.fill('#phone', customer.phone)
  await page.selectOption('#governorate', customer.governorate)
  await page.fill('#address', customer.address)
  if (customer.notes) {
    await page.getByRole('button', { name: 'ضيف ملاحظة للطلب' }).click()
    await page.fill('#notes', customer.notes)
  }
  const clickedAt = Date.now()
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => url.pathname.startsWith('/order/'), { timeout: 20000 })
  const ms = Date.now() - clickedAt
  await page.waitForLoadState('load').catch(() => {})
  const mark = await page.evaluate(() => window.__pixelE2eMark || null).catch(() => null)
  const after = await docOf(page).catch(() => null)
  return { ms, sameDocument: mark === 'checkout' && after === before, before, after, url: page.url() }
}
