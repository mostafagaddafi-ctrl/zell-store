/**
 * META-PIXEL §٤-٣ — حالات اختبار المتصفح P01–P14ج. كل حالة بتاخد { browser, expect, note, app } وبتفتح سياقاتها بنفسها.
 * app: { applyPixelId(value) } من run.mjs (المصدر الصناعي + /api/revalidate).
 */
import {
  ALT_ORIGIN,
  CART_PIECE,
  CART_PIECE_3,
  MOBILE,
  ORDER_NUMBER,
  ORIGIN,
  blockedSends,
  calls,
  docEntry,
  docOf,
  inits,
  internalNav,
  leaks,
  ofDoc,
  openContext,
  routerRefresh,
  scriptBytes,
  sends,
  sleep,
  submitOrder,
  tracks,
  waitFor,
  waitForArmed,
  waitForInit,
  waitForSdkAppend,
} from './harness.mjs'
import { CONTENT_TRACK_LABEL, GOVERNORATE, METER_ID, PIECE_ID, TRACK_CUSTOMER, TRACK_ORDER_NUMBER } from './source.mjs'

export const VALID_ID = '1234567890123456'
export const OTHER_VALID_ID = '9876543210987654'
export const INVALID_IDS = ['abc', '123', '1234567890123456789012345']

const PLAIN_CUSTOMER = { name: 'عميل اختبار', phone: '01055555555', governorate: GOVERNORATE, address: 'عنوان اختبار رقم ١٢٣٤٥' }
const PRIVATE_CUSTOMER = {
  name: 'PRIVATE_NAME_P08',
  phone: '01098765432',
  governorate: GOVERNORATE,
  address: 'PRIVATE_ADDR_P08 شارع ٩',
  notes: 'PRIVATE_NOTE_P08',
}
export const PII_MARKERS = [
  'PRIVATE_',
  PRIVATE_CUSTOMER.phone,
  TRACK_CUSTOMER.phone,
  ORDER_NUMBER.slice(4),
  TRACK_ORDER_NUMBER.slice(4),
]

const sdkAppends = (state, docId) => ofDoc(state, docId, 'sdk-append')
const fakeExecs = (state, docId) => ofDoc(state, docId, 'fake-exec')

async function gotoLoad(page, url) {
  await page.goto(url, { waitUntil: 'load' })
  return docOf(page)
}

async function addButton(page, name) {
  const button = page.getByRole('button', { name, exact: true }).first()
  await button.waitFor({ state: 'visible', timeout: 15000 })
  await button.click()
}

/** الخانة فاضية أو غلط: مفيش سكربت ولا fbq ولا كوكي، والإيصال انتقال داخلي (P01 وP02). */
async function assertDormant(browser, expect, note, label) {
  const { context, page, state } = await openContext(browser, { cart: CART_PIECE })
  try {
    for (const target of ['/', '/product/' + String(METER_ID), '/checkout']) {
      await gotoLoad(page, ORIGIN + target)
      await sleep(5000)
      const fbq = await page.evaluate(() => typeof window.fbq)
      expect(fbq === 'undefined', label + ' ' + target + ': typeof window.fbq = ' + fbq)
      if (target === '/') note(label + ' js bytes on /', await scriptBytes(page))
    }
    const cookies = await context.cookies()
    expect(!cookies.some((cookie) => cookie.name === '_fbp'), label + ': _fbp cookie exists')
    expect(state.sdkRequests.length === 0, label + ': sdk requests = ' + String(state.sdkRequests.length))
    const receipt = await submitOrder(page, state, PLAIN_CUSTOMER)
    expect(receipt.sameDocument, label + ': receipt navigation was not internal ' + JSON.stringify(receipt))
    await sleep(1500)
    expect(state.sdkRequests.length === 0, label + ': sdk requests after receipt = ' + String(state.sdkRequests.length))
    note(label, { sdkRequests: state.sdkRequests.length, receiptInternal: receipt.sameDocument, receiptMs: receipt.ms, external: state.external.length })
  } finally {
    await context.close()
  }
}

export async function P01({ browser, expect, note }) {
  await assertDormant(browser, expect, note, 'empty')
}

export async function P02({ browser, expect, note, app }) {
  for (const id of INVALID_IDS) {
    await app.applyPixelId(id)
    await assertDormant(browser, expect, note, 'id=' + id)
  }
  await app.applyPixelId('')
}

export async function P03({ browser, expect, note }) {
  const { context, page, state } = await openContext(browser)
  try {
    const doc = await gotoLoad(page, ORIGIN + '/')
    await waitForInit(state, doc)
    const append = sdkAppends(state, doc)[0]
    expect(Boolean(append), 'no sdk append')
    if (append) {
      expect(typeof append.loadEventEnd === 'number' && append.loadEventEnd > 0, 'loadEventEnd missing: ' + String(append.loadEventEnd))
      expect(append.t >= append.loadEventEnd, 'script appended before loadEventEnd: t=' + String(append.t) + ' loadEventEnd=' + String(append.loadEventEnd))
    }
    // §٤-٤ — مجموع JS على / بعد التهيئة (ومنه الـ runtime الديناميكي)، للمقارنة بـ P01 (الخانة فاضية)
    await sleep(1000)
    note('js bytes on / after init', await scriptBytes(page))
    const first = calls(state, doc).slice(0, 2).map((entry) => entry.args)
    expect(
      JSON.stringify(first) === JSON.stringify([['set', 'autoConfig', false, VALID_ID], ['init', VALID_ID]]),
      'first calls = ' + JSON.stringify(first),
    )
    const consumed = ofDoc(state, doc, 'fake-consumed')[0]
    expect(Boolean(consumed) && Array.isArray(consumed.queue) && consumed.queue.length === 0, 'stub queue not empty: ' + JSON.stringify(consumed))
    await internalNav(page, '/products')
    await internalNav(page, '/product/' + String(METER_ID))
    await sleep(2000)
    expect(state.sdkRequests.length === 1, 'sdk requests = ' + String(state.sdkRequests.length))
    expect(sdkAppends(state, doc).length === 1, 'sdk appends = ' + String(sdkAppends(state, doc).length))
    expect(inits(state, doc).length === 1, 'inits = ' + String(inits(state, doc).length))
    note('evidence', {
      loadEventEnd: append ? Math.round(append.loadEventEnd) : null,
      appendedAt: append ? Math.round(append.t) : null,
      sdkRequests: state.sdkRequests.length,
      inits: inits(state, doc).length,
      firstCalls: first,
    })
  } finally {
    await context.close()
  }
}

export async function P04({ browser, expect, note }) {
  for (const entry of ['/order/' + ORDER_NUMBER, '/track']) {
    const { context, page, state } = await openContext(browser)
    try {
      const doc = await gotoLoad(page, ORIGIN + entry)
      await sleep(3000)
      await internalNav(page, '/products')
      await internalNav(page, '/product/' + String(METER_ID))
      await sleep(5000)
      const fbq = await page.evaluate(() => typeof window.fbq)
      expect(sdkAppends(state, doc).length === 0, entry + ': sdk appends = ' + String(sdkAppends(state, doc).length))
      expect(state.sdkRequests.length === 0, entry + ': sdk requests = ' + String(state.sdkRequests.length))
      expect(calls(state, doc).length === 0, entry + ': fbq calls = ' + String(calls(state, doc).length))
      expect(fbq === 'undefined', entry + ': typeof window.fbq = ' + fbq)
      note(entry, { sdkRequests: state.sdkRequests.length, fbqCalls: calls(state, doc).length, fbq })
    } finally {
      await context.close()
    }
  }
}

async function trackLinkFullNavigation(browser, expect, note, label, viewport, click) {
  const { context, page, state } = await openContext(browser, { viewport })
  try {
    const doc = await gotoLoad(page, ORIGIN + '/')
    await waitForInit(state, doc)
    await page.evaluate(() => {
      window.__pixelE2eMark = 'armed'
    })
    await click(page)
    await page.waitForURL((url) => url.pathname === '/track', { timeout: 15000 })
    await page.waitForLoadState('load')
    const mark = await page.evaluate(() => window.__pixelE2eMark || null)
    const next = await docOf(page)
    await sleep(3000)
    expect(mark === null && next !== doc, label + ': /track was not a new document (mark=' + String(mark) + ')')
    expect(sdkAppends(state, next).length === 0, label + ': sdk appended in /track document')
    expect(calls(state, next).length === 0, label + ': fbq calls in /track document')
    expect(blockedSends(state).length === 0, label + ': sends from a blocked url = ' + JSON.stringify(blockedSends(state)))
    note(label, { newDocument: mark === null && next !== doc, blockedSends: blockedSends(state).length, sends: sends(state).length })
  } finally {
    await context.close()
  }
}

export async function P05({ browser, expect, note }) {
  await trackLinkFullNavigation(browser, expect, note, 'header', undefined, async (page) => {
    await page.locator('header a[href="/track"]').filter({ visible: true }).first().click()
  })
  await trackLinkFullNavigation(browser, expect, note, 'footer', undefined, async (page) => {
    const link = page.locator('footer a[href="/track"]').first()
    await link.scrollIntoViewIfNeeded()
    await link.click()
  })
  await trackLinkFullNavigation(browser, expect, note, 'mobile menu', MOBILE, async (page) => {
    await page.locator('button[aria-label="افتح القائمة"]').first().click()
    const link = page.locator('nav[aria-label="قائمة المتجر"] a[href="/track"]').first()
    await link.waitFor({ state: 'visible', timeout: 10000 })
    await link.click()
  })
}

export async function P06({ browser, expect, note }) {
  const { context, page, state } = await openContext(browser, { cart: CART_PIECE, fake: { delayMs: 5000 } })
  try {
    const doc = await gotoLoad(page, ORIGIN + '/checkout')
    await waitForSdkAppend(state, doc)
    expect(fakeExecs(state, doc).length === 0, 'fake script ran before submit (should still be loading)')
    const receipt = await submitOrder(page, state, PLAIN_CUSTOMER)
    expect(!receipt.sameDocument, 'receipt was not a new document')
    expect(receipt.ms < 4000, 'receipt navigation took ' + String(receipt.ms) + 'ms')
    await sleep(6500)
    expect(blockedSends(state).length === 0, 'sends from a blocked url = ' + JSON.stringify(blockedSends(state)))
    expect(sdkAppends(state, receipt.after).length === 0, 'sdk appended in receipt document')
    note('evidence', { receiptMs: receipt.ms, newDocument: !receipt.sameDocument, sends: sends(state).length, blockedSends: blockedSends(state).length })
  } finally {
    await context.close()
  }
}

export async function P07({ browser, expect, note }) {
  const { context, page, state } = await openContext(browser, { cart: CART_PIECE, fake: { sendDelayMs: 3000 } })
  try {
    const doc = await gotoLoad(page, ORIGIN + '/checkout')
    await waitForInit(state, doc)
    const receipt = await submitOrder(page, state, PLAIN_CUSTOMER)
    expect(!receipt.sameDocument, 'receipt was not a new document')
    await sleep(4500)
    const purchaseSends = sends(state).filter((entry) => entry.event === 'Purchase')
    const wrong = purchaseSends.filter((entry) => new URL(entry.href).pathname !== '/checkout')
    expect(wrong.length === 0, 'Purchase sent from ' + JSON.stringify(wrong.map((entry) => entry.href)))
    expect(blockedSends(state).length === 0, 'sends from a blocked url = ' + JSON.stringify(blockedSends(state)))
    note('evidence', {
      purchaseCalls: tracks(state, doc, 'Purchase').length,
      purchaseSends: purchaseSends.map((entry) => entry.href),
      blockedSends: blockedSends(state).length,
    })
  } finally {
    await context.close()
  }
}

export async function P08({ browser, expect, note }) {
  const states = []
  // (أ) Purchase بالمفاتيح المسموحة بس (سطر قطعة بكمية 3 ⇐ num_items = 3)
  {
    const { context, page, state } = await openContext(browser, { cart: CART_PIECE_3 })
    states.push(state)
    try {
      const doc = await gotoLoad(page, ORIGIN + '/checkout')
      await waitForInit(state, doc)
      const receipt = await submitOrder(page, state, PRIVATE_CUSTOMER)
      await sleep(2000)
      const purchase = tracks(state, doc, 'Purchase')
      expect(purchase.length === 1, 'Purchase calls = ' + String(purchase.length))
      const params = purchase[0] ? purchase[0].args[2] : null
      const keys = params ? Object.keys(params).sort() : []
      expect(JSON.stringify(keys) === JSON.stringify(['content_ids', 'content_type', 'currency', 'num_items', 'value']), 'Purchase keys = ' + JSON.stringify(keys))
      expect(params !== null && params.value === 267 && params.currency === 'EGP', 'Purchase value/currency = ' + JSON.stringify(params))
      expect(params !== null && JSON.stringify(params.content_ids) === JSON.stringify([String(PIECE_ID)]) && params.num_items === 3, 'Purchase content = ' + JSON.stringify(params))
      expect(state.orders.length === 1 && state.orders[0].includes(PRIVATE_CUSTOMER.name), 'order body did not reach the mocked /api/orders')
      note('purchase', { params, receiptNewDocument: !receipt.sameDocument })
    } finally {
      await context.close()
    }
  }
  // (ب) replayed = true ⇐ مفيش Purchase
  {
    const { context, page, state } = await openContext(browser, { cart: CART_PIECE })
    states.push(state)
    try {
      const doc = await gotoLoad(page, ORIGIN + '/checkout')
      await waitForInit(state, doc)
      const receipt = await submitOrder(page, state, PRIVATE_CUSTOMER, { replayed: true })
      await sleep(2000)
      expect(tracks(state, doc, 'Purchase').length === 0, 'Purchase sent for replayed = true')
      expect(receipt.url.includes('/order/'), 'no receipt navigation for replayed = true')
      note('replayed', { purchaseCalls: tracks(state, doc, 'Purchase').length })
    } finally {
      await context.close()
    }
  }
  // (ج) بحث /track بيعرض بيانات شخصية
  {
    const { context, page, state } = await openContext(browser)
    states.push(state)
    try {
      const doc = await gotoLoad(page, ORIGIN + '/')
      await waitForInit(state, doc)
      await page.locator('header a[href="/track"]').filter({ visible: true }).first().click()
      await page.waitForURL((url) => url.pathname === '/track', { timeout: 15000 })
      await page.waitForLoadState('load')
      await page.fill('#track-code', TRACK_ORDER_NUMBER)
      await page.click('form button[type="submit"]')
      await page.getByText(TRACK_CUSTOMER.name).first().waitFor({ state: 'visible', timeout: 20000 })
      await sleep(2000)
      await page.goBack({ waitUntil: 'load' })
      await sleep(3000)
      note('track', { shown: true, backUrl: page.url() })
    } finally {
      await context.close()
    }
  }
  const found = []
  for (const state of states) found.push(...leaks(state, PII_MARKERS))
  expect(found.length === 0, 'personal values leaked: ' + JSON.stringify(Array.from(new Set(found))))
  note('leaks', Array.from(new Set(found)))
}

export async function P09({ browser, expect, note }) {
  const { context, page, state } = await openContext(browser)
  try {
    const doc = await gotoLoad(page, ORIGIN + '/')
    await waitForInit(state, doc)
    await internalNav(page, '/products')
    await internalNav(page, '/product/' + String(METER_ID))
    await internalNav(page, '/product/' + String(PIECE_ID))
    await page.goBack()
    await page.waitForFunction((target) => location.pathname === target, '/product/' + String(METER_ID))
    await sleep(1000)
    await page.goForward()
    await page.waitForFunction((target) => location.pathname === target, '/product/' + String(PIECE_ID))
    await sleep(1000)
    // AddToCart من PieceBuy
    await addButton(page, 'ضيف للسلة')
    await sleep(800)
    // AddToCart من ProductBuy
    await internalNav(page, '/product/' + String(METER_ID))
    await addButton(page, 'ضيف للسلة')
    await sleep(800)
    // AddToCart من InstallationToolsList
    await internalNav(page, '/installation-tools?for=' + String(METER_ID))
    await page.locator('button[aria-label="زوّد أداة اختبار"]').first().click()
    await page.getByRole('button', { name: /^ضيف للسلة ·/ }).first().click()
    await sleep(800)
    await internalNav(page, '/checkout')
    await sleep(2500)
    expect(page.url().startsWith(ORIGIN + '/checkout') && (await docOf(page)) === doc, 'left the document')

    const count = (name) => tracks(state, doc, name).length
    const addIds = tracks(state, doc, 'AddToCart').map((entry) => (entry.args[2] ? entry.args[2].content_ids : null))
    const counts = {
      PageView: count('PageView'),
      ViewContent: count('ViewContent'),
      AddToCart: count('AddToCart'),
      InitiateCheckout: count('InitiateCheckout'),
      init: inits(state, doc).length,
      sdkRequests: state.sdkRequests.length,
    }
    expect(counts.PageView === 9, 'PageView = ' + String(counts.PageView) + ' (expected 9)')
    expect(counts.ViewContent === 5, 'ViewContent = ' + String(counts.ViewContent) + ' (expected 5)')
    expect(counts.AddToCart === 3, 'AddToCart = ' + String(counts.AddToCart) + ' (expected 3)')
    expect(JSON.stringify(addIds) === JSON.stringify([['2'], ['1'], ['2']]), 'AddToCart ids = ' + JSON.stringify(addIds))
    expect(counts.InitiateCheckout === 1, 'InitiateCheckout = ' + String(counts.InitiateCheckout))
    expect(counts.init === 1 && counts.sdkRequests === 1, 'init/sdk = ' + JSON.stringify(counts))
    note('counts', counts)
  } finally {
    await context.close()
  }
}

async function failureCase(browser, expect, note, label, fake, waitStage) {
  const { context, page, state } = await openContext(browser, { cart: CART_PIECE, fake })
  try {
    const doc = await gotoLoad(page, ORIGIN + '/checkout')
    await waitForSdkAppend(state, doc)
    if (waitStage === 'exec') await waitFor(() => fakeExecs(state, doc)[0], 15000, 'fake exec')
    if (waitStage === 'init') await waitForInit(state, doc)
    await sleep(1500)
    const receipt = await submitOrder(page, state, PLAIN_CUSTOMER)
    const cartLines = await page.evaluate(() => {
      try {
        const raw = window.localStorage.getItem('zell-cart-v2')
        return raw ? JSON.parse(raw).length : 0
      } catch (error) {
        return -1
      }
    })
    const errors = state.pageErrors.filter((message) => !message.includes('FAKE_FBEVENTS_THROW'))
    expect(receipt.url.includes('/order/' + ORDER_NUMBER), label + ': no receipt navigation')
    expect(cartLines === 0, label + ': cart lines after order = ' + String(cartLines))
    expect(errors.length === 0, label + ': page errors ' + JSON.stringify(errors))
    note(label, { receipt: receipt.url.replace(ORIGIN, ''), cartLines, pageErrors: state.pageErrors })
  } finally {
    await context.close()
  }
}

export async function P10({ browser, expect, note }) {
  await failureCase(browser, expect, note, 'script 500', { status: 500 }, 'append')
  await failureCase(browser, expect, note, 'script throws', { throwOnExec: true }, 'exec')
  await failureCase(browser, expect, note, 'fbq throws', { fbqThrows: 'track' }, 'init')
}

export async function P11({ browser, expect, note, app }) {
  // (أ) الـ ID اتفضّى بعد التحميل ⇐ مفيش أحداث جديدة
  {
    await app.applyPixelId(VALID_ID)
    const { context, page, state } = await openContext(browser)
    try {
      const doc = await gotoLoad(page, ORIGIN + '/')
      await waitForInit(state, doc)
      await sleep(1500)
      const before = calls(state, doc).length
      await app.applyPixelId('')
      await routerRefresh(page)
      await sleep(3000)
      await internalNav(page, '/products')
      await internalNav(page, '/product/' + String(PIECE_ID))
      await addButton(page, 'ضيف للسلة')
      await sleep(2000)
      const after = calls(state, doc).length
      expect(after === before, 'loaded then emptied: fbq calls ' + String(before) + ' -> ' + String(after) + ' ' + JSON.stringify(calls(state, doc).slice(before).map((entry) => entry.args)))
      note('emptied after load', { before, after })
    } finally {
      await context.close()
    }
  }
  // (ب) الـ ID اتفضّى قبل طلب السكربت ⇐ مفيش طلب
  {
    await app.applyPixelId(VALID_ID)
    const { context, page, state } = await openContext(browser, { holdImage: true })
    try {
      await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
      const doc = await docOf(page)
      await waitForArmed(page)
      expect(sdkAppends(state, doc).length === 0, 'sdk appended while load was held')
      await app.applyPixelId('')
      await routerRefresh(page)
      await sleep(3000)
      state.release()
      await page.waitForLoadState('load')
      await sleep(6000)
      expect(sdkAppends(state, doc).length === 0, 'emptied before request: sdk appends = ' + String(sdkAppends(state, doc).length))
      expect(state.sdkRequests.length === 0, 'emptied before request: sdk requests = ' + String(state.sdkRequests.length))
      expect(calls(state, doc).length === 0, 'emptied before request: fbq calls = ' + String(calls(state, doc).length))
      note('emptied before request', { sdkRequests: state.sdkRequests.length, calls: calls(state, doc).length })
    } finally {
      state.release()
      await context.close()
    }
  }
  // (ج) ID تاني صالح ⇐ مفيش init تاني
  {
    await app.applyPixelId(VALID_ID)
    const { context, page, state } = await openContext(browser)
    try {
      const doc = await gotoLoad(page, ORIGIN + '/')
      await waitForInit(state, doc)
      await app.applyPixelId(OTHER_VALID_ID)
      await routerRefresh(page)
      await sleep(3000)
      await internalNav(page, '/products')
      await sleep(1500)
      const all = inits(state, doc).map((entry) => entry.args[1])
      expect(JSON.stringify(all) === JSON.stringify([VALID_ID]), 'inits = ' + JSON.stringify(all))
      expect(state.sdkRequests.length === 1, 'sdk requests = ' + String(state.sdkRequests.length))
      note('other valid id', { inits: all, sdkRequests: state.sdkRequests.length })
    } finally {
      await context.close()
    }
  }
  // (د) B1 — السكربت متحمّل ومهيّأ وفيه إرسال مؤجّل ← الـ ID اتفضّى ← لينك «محتوى» ديناميكي (next/link) لـ /track
  {
    await app.applyPixelId(VALID_ID)
    const { context, page, state } = await openContext(browser, { fake: { sendDelayMs: 15000 } })
    try {
      const doc = await gotoLoad(page, ORIGIN + '/')
      await waitForInit(state, doc)
      await internalNav(page, '/products')
      const pending = tracks(state, doc, 'PageView').length
      await app.applyPixelId('')
      await routerRefresh(page)
      await sleep(2500)
      expect(sends(state).length === 0, 'a send happened before the link click (delay too short)')
      await page.evaluate(() => {
        window.__pixelE2eMark = 'armed'
      })
      const link = page.getByRole('link', { name: CONTENT_TRACK_LABEL }).first()
      await link.scrollIntoViewIfNeeded()
      await link.click()
      await page.waitForURL((url) => url.pathname === '/track', { timeout: 15000 })
      await page.waitForLoadState('load')
      const mark = await page.evaluate(() => window.__pixelE2eMark || null)
      const next = await docOf(page)
      await sleep(16000)
      expect(pending >= 2, 'no pending PageView before emptying: ' + String(pending))
      expect(mark === null && next !== doc, 'content link to /track stayed inside the document that holds the SDK (mark=' + String(mark) + ')')
      expect(blockedSends(state).length === 0, 'sends from a blocked url = ' + JSON.stringify(blockedSends(state)))
      expect(sdkAppends(state, next).length === 0, 'sdk appended in /track document')
      note('emptied, delayed send, content link', { pendingPageViews: pending, newDocument: mark === null && next !== doc, sends: sends(state).length, blockedSends: blockedSends(state).length })
    } finally {
      await context.close()
    }
  }
  // (هـ) B1 — بعد الإيقاف (الـ ID اتفضّى بعد التحميل): توسيخ العنوان لسه بيتراقب ويتنضّف
  {
    await app.applyPixelId(VALID_ID)
    const { context, page, state } = await openContext(browser)
    try {
      const doc = await gotoLoad(page, ORIGIN + '/')
      await waitForInit(state, doc)
      await sleep(1500)
      await app.applyPixelId('')
      await routerRefresh(page)
      await sleep(2500)
      const before = calls(state, doc).length
      await page.evaluate(() => {
        location.hash = '#PRIVATE_H7'
      })
      await sleep(1000)
      const afterHash = page.url()
      await internalNav(page, '/products')
      await sleep(1500)
      expect(!afterHash.includes('PRIVATE_'), 'hash after stop not cleaned: ' + afterHash)
      expect(calls(state, doc).length === before, 'fbq calls after stop: ' + String(before) + ' -> ' + String(calls(state, doc).length))
      note('url guard after stop', { urlAfterHash: afterHash.replace(ORIGIN, ''), callsBefore: before, callsAfter: calls(state, doc).length })
    } finally {
      await context.close()
    }
  }
  // (و) مستند بدأ والخانة فاضية: مابيتسلّحش (مفيش جسر ولا حراسة)، ونفس لينك «المحتوى» انتقال داخلي زي النهارده
  {
    await app.applyPixelId('')
    const { context, page, state } = await openContext(browser)
    try {
      const doc = await gotoLoad(page, ORIGIN + '/')
      await page.evaluate(() => {
        window.__pixelE2eMark = 'empty'
      })
      await sleep(1000)
      const neverArmed = await page.evaluate(() => {
        const boot = window.__zellPixelBoot
        return !boot || boot.bridge === null
      })
      const link = page.getByRole('link', { name: CONTENT_TRACK_LABEL }).first()
      await link.scrollIntoViewIfNeeded()
      await link.click()
      await page.waitForURL((url) => url.pathname === '/track', { timeout: 15000 })
      await sleep(1500)
      const mark = await page.evaluate(() => window.__pixelE2eMark || null)
      const same = (await docOf(page)) === doc
      expect(neverArmed, 'empty-start document: pixel bridge registered')
      expect(mark === 'empty' && same, 'empty-start document: content link was not an internal navigation')
      expect(state.sdkRequests.length === 0, 'empty-start document: sdk requested')
      note('empty-start document', { neverArmed, internal: mark === 'empty' && same, sdkRequests: state.sdkRequests.length })
    } finally {
      await context.close()
    }
  }
  // (ز) مراجعة 05a11e7 — مستند بدأ والخانة فاضية، وفيه تاريخ مش نضيف، وبعدين ID صالح بـ router.refresh جوه نفس المستند
  {
    await app.applyPixelId('')
    const { context, page, state } = await openContext(browser)
    try {
      const doc = await gotoLoad(page, ORIGIN + '/?phone=PRIVATE_Q9')
      await internalNav(page, '/products')
      await page.evaluate(() => {
        window.__pixelE2eMark = 'empty-start'
      })
      await app.applyPixelId(VALID_ID)
      await routerRefresh(page)
      await sleep(3000)
      await internalNav(page, '/product/' + String(METER_ID))
      await sleep(6000)
      const neverArmed = await page.evaluate(() => {
        const boot = window.__zellPixelBoot
        return !boot || boot.bridge === null
      })
      const mark = await page.evaluate(() => window.__pixelE2eMark || null)
      expect(mark === 'empty-start' && (await docOf(page)) === doc, 'empty-start: document was replaced')
      expect(neverArmed, 'empty-start document armed after a valid id arrived')
      expect(state.sdkRequests.length === 0 && sdkAppends(state, doc).length === 0, 'empty-start document requested the sdk')
      expect(calls(state, doc).length === 0, 'empty-start document: fbq calls')
      note('empty start then valid id', { neverArmed, sdkRequests: state.sdkRequests.length, calls: calls(state, doc).length })
    } finally {
      await context.close()
    }
  }
  // (ح) ع١-ب — الخانة صالحة من الأول، بس التسليح اتأخر (chunk الـ runtime محجوز) والمستند مرّ بعنوان مش نضيف قبله
  {
    await app.applyPixelId(VALID_ID)
    const { context, page, state } = await openContext(browser, { holdPixelChunk: true })
    try {
      await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
      const doc = await docOf(page)
      await waitFor(() => state.pixelChunk, 20000, 'pixel runtime chunk requested')
      // سطر سجل مش نضيف بيفضل في السجل (push)، وبعدين العنوان الحالي نضيف وقت التسليح
      await internalNav(page, '/products?x=PRIVATE_Q10')
      await internalNav(page, '/products')
      const historyLength = await page.evaluate(() => history.length)
      state.releaseChunk()
      await waitForArmed(page)
      await sleep(6000)
      expect(state.sdkRequests.length === 0 && sdkAppends(state, doc).length === 0, 'armed after unclean history: sdk requested')
      expect(calls(state, doc).length === 0, 'armed after unclean history: fbq calls')
      note('unclean history before arming', { chunk: state.pixelChunk, historyLength, sdkRequests: state.sdkRequests.length, calls: calls(state, doc).length })
    } finally {
      state.releaseChunk()
      await context.close()
    }
  }
  // (ط) ضابط لـ (ح): نفس الحجز من غير تاريخ مش نضيف ⇐ السكربت بيتحمّل عادي
  {
    const { context, page, state } = await openContext(browser, { holdPixelChunk: true })
    try {
      await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
      const doc = await docOf(page)
      await waitFor(() => state.pixelChunk, 20000, 'pixel runtime chunk requested')
      await sleep(800)
      state.releaseChunk()
      await waitForInit(state, doc)
      expect(inits(state, doc).length === 1, 'control: no init after release')
      note('control: held chunk, clean history', { inits: inits(state, doc).length })
    } finally {
      state.releaseChunk()
      await context.close()
    }
  }
  await app.applyPixelId(VALID_ID)
}

async function dirtyEntry(browser, expect, note, label, url, expected) {
  const { context, page, state } = await openContext(browser)
  try {
    const doc = await gotoLoad(page, ORIGIN + url)
    const append = await waitForSdkAppend(state, doc)
    await waitForInit(state, doc)
    await sleep(1500)
    const finalUrl = page.url()
    const dirtySeq = ofDoc(state, doc, 'replaceState')
      .filter((entry) => entry.seq < append.seq && !String(entry.href).includes('PRIVATE_'))
      .map((entry) => entry.seq)
    expect(finalUrl === ORIGIN + expected, label + ': url = ' + finalUrl)
    expect(append.href === ORIGIN + expected, label + ': url at script request = ' + append.href)
    expect(dirtySeq.length > 0, label + ': no clean replaceState before the script request')
    const referers = state.external.map((entry) => entry.headers['referer'] || null).filter((value) => value !== null)
    const badReferers = referers.filter((value) => value !== ORIGIN + '/')
    expect(badReferers.length === 0, label + ': Referer = ' + JSON.stringify(badReferers))
    note(label, { finalUrl: finalUrl.replace(ORIGIN, ''), atRequest: append.href.replace(ORIGIN, ''), cleanedBeforeRequest: dirtySeq.length > 0, referers: Array.from(new Set(referers)) })
  } finally {
    await context.close()
  }
}

export async function P12({ browser, expect, note }) {
  await dirtyEntry(browser, expect, note, 'home', '/?phone=PRIVATE_Q1&utm_content=PRIVATE_Q2&fbclid=TESTCLID#PRIVATE_H1', '/?fbclid=TESTCLID')
  await dirtyEntry(browser, expect, note, 'product', '/product/' + String(METER_ID) + '?email=PRIVATE_Q3#PRIVATE_H2', '/product/' + String(METER_ID))
  await dirtyEntry(browser, expect, note, 'tools', '/installation-tools?for=' + String(METER_ID) + '&x=PRIVATE_Q4', '/installation-tools?for=' + String(METER_ID))
}

async function taintedEntry(browser, expect, note, url) {
  const { context, page, state } = await openContext(browser)
  try {
    const doc = await gotoLoad(page, ORIGIN + url)
    await sleep(6000)
    expect(page.url() === ORIGIN + url, url + ': url changed to ' + page.url())
    expect(sdkAppends(state, doc).length === 0 && state.sdkRequests.length === 0, url + ': sdk requested')
    expect(calls(state, doc).length === 0, url + ': fbq calls')
    note(url, { url: page.url().replace(ORIGIN, ''), sdkRequests: state.sdkRequests.length })
  } finally {
    await context.close()
  }
}

export async function P12b({ browser, expect, note }) {
  await taintedEntry(browser, expect, note, '/PRIVATE_NAME_TEST')
  await taintedEntry(browser, expect, note, '/product/01012345678')
  await taintedEntry(browser, expect, note, '/collection/PRIVATE_SLUG_TEST')
  const { context, page, state } = await openContext(browser)
  try {
    const doc = await gotoLoad(page, ORIGIN + '/installation-tools?for=01012345678')
    const append = await waitForSdkAppend(state, doc)
    await waitForInit(state, doc)
    await sleep(1500)
    expect(!page.url().includes('01012345678'), 'for not removed: ' + page.url())
    expect(!append.href.includes('01012345678'), 'for present at script request: ' + append.href)
    const found = leaks(state, ['01012345678'])
    expect(found.length === 0, 'non-member for leaked')
    note('for non-member', { url: page.url().replace(ORIGIN, ''), atRequest: append.href.replace(ORIGIN, '') })
  } finally {
    await context.close()
  }
}

async function referrerCase(browser, expect, note, label, start, go, expectLoad) {
  const { context, page, state } = await openContext(browser)
  try {
    await page.goto(start, { waitUntil: 'load' })
    const first = await docOf(page)
    await sleep(1500)
    await go(page)
    await page.waitForURL((url) => url.origin === ORIGIN && url.pathname !== new URL(start).pathname, { timeout: 15000 })
    await page.waitForLoadState('load')
    const doc = await docOf(page)
    const referrer = docEntry(state, doc) ? docEntry(state, doc).referrer : null
    if (expectLoad) {
      await waitForInit(state, doc)
      await sleep(1500)
    } else {
      await sleep(6000)
    }
    const appended = sdkAppends(state, doc).length
    expect(doc !== first, label + ': not a new document')
    if (expectLoad) expect(appended === 1 && inits(state, doc).length === 1, label + ': script not loaded (appends=' + String(appended) + ')')
    else expect(appended === 0 && calls(state, doc).length === 0, label + ': script requested with a sensitive referrer')
    note(label, { referrer, scriptLoaded: appended > 0 })
  } finally {
    await context.close()
  }
}

export async function P13({ browser, expect, note }) {
  await referrerCase(browser, expect, note, '(a) /track?order', ORIGIN + '/track?order=PRIVATE_R1', (page) => page.evaluate(() => location.assign('/')), false)
  await referrerCase(browser, expect, note, '(b) cleaned /', ORIGIN + '/?phone=PRIVATE_R2', async (page) => {
    await waitFor(() => page.evaluate(() => !location.href.includes('PRIVATE_')), 15000, 'clean url')
    await page.evaluate(() => location.assign('/products'))
  }, true)
  await referrerCase(browser, expect, note, '(c) other origin unsafe-url', ALT_ORIGIN + '/ref?policy=unsafe-url&x=PRIVATE_R3', (page) => page.click('#go'), false)
  await referrerCase(browser, expect, note, '(d) other origin origin-only', ALT_ORIGIN + '/ref?policy=origin&x=PRIVATE_R3', (page) => page.click('#go'), true)
  await referrerCase(browser, expect, note, '(e) unknown path', ORIGIN + '/PRIVATE_NAME_TEST', (page) => page.evaluate(() => location.assign('/')), false)
}

export async function P14a({ browser, expect, note }) {
  const { context, page, state } = await openContext(browser, { holdImage: true })
  try {
    await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
    const doc = await docOf(page)
    await waitForArmed(page)
    expect(sdkAppends(state, doc).length === 0, 'sdk appended while load was held')
    await page.evaluate(() => {
      history.replaceState(null, '', '/?x=PRIVATE_Q5')
      location.hash = '#PRIVATE_H3'
    })
    await sleep(500)
    await internalNav(page, '/product/' + String(METER_ID))
    expect(sdkAppends(state, doc).length === 0, 'sdk appended before release')
    state.release()
    const append = await waitForSdkAppend(state, doc)
    await waitForInit(state, doc)
    await sleep(2000)
    const dirty = ofDoc(state, doc, 'replaceState').filter((entry) => String(entry.url).includes('PRIVATE_Q5'))
    const beforeRequest = ofDoc(state, doc, 'replaceState').filter((entry) => entry.seq < append.seq)
    const lastBefore = beforeRequest[beforeRequest.length - 1]
    expect(dirty.length >= 1 && dirty[0].seq < append.seq, 'dirty replaceState not recorded before the request')
    expect(Boolean(lastBefore) && !String(lastBefore.href).includes('PRIVATE_'), 'last replaceState before the request left ' + (lastBefore ? lastBefore.href : 'nothing'))
    expect(!append.href.includes('PRIVATE_'), 'url at script request = ' + append.href)
    expect(sends(state).length > 0, 'no sends after release')
    note('evidence', { atRequest: append.href.replace(ORIGIN, ''), sends: sends(state).map((entry) => entry.event) })
  } finally {
    state.release()
    await context.close()
  }
}

async function dirtyDuringLoad(browser, expect, note, label, fake, dirtyFromTest, expectCleanUrl) {
  const { context, page, state } = await openContext(browser, { fake })
  try {
    const doc = await gotoLoad(page, ORIGIN + '/')
    await waitForSdkAppend(state, doc)
    if (dirtyFromTest) {
      await internalNav(page, '/products')
      await page.evaluate(() => {
        location.hash = '#PRIVATE_H5'
      })
    }
    await waitFor(() => ofDoc(state, doc, 'fake-consumed')[0], 15000, 'fake consumed')
    await sleep(2500)
    const consumed = ofDoc(state, doc, 'fake-consumed')[0]
    expect(Array.isArray(consumed.queue) && consumed.queue.length === 0, label + ': consumed queue = ' + JSON.stringify(consumed.queue))
    expect(calls(state, doc).length === 0, label + ': fbq calls = ' + JSON.stringify(calls(state, doc).map((entry) => entry.args)))
    expect(sends(state).length === 0, label + ': sends = ' + String(sends(state).length))
    // ن٣ (٣) — بعد التلوث الـ runtime بيعمل replaceState للعنوان النضيف. في نسخة replaceState من غير حدث، راوتر Next
    // ممكن يرجّع عنوانه بعدها؛ ده مش من شروط النجاح في §٤-٣ (المستند ملوّث ومفيش أي طلب)، وبيتسجّل كملاحظة.
    const urlAfterTaint = page.url()
    if (expectCleanUrl) expect(!urlAfterTaint.includes('PRIVATE_'), label + ': url still dirty ' + urlAfterTaint)
    const replaceLog = ofDoc(state, doc, 'replaceState').map((entry) => ({ seq: entry.seq, url: entry.url, href: String(entry.href).replace(ORIGIN, '') }))
    await internalNav(page, '/product/' + String(METER_ID))
    await sleep(1500)
    expect(calls(state, doc).length === 0, label + ': fbq calls after navigation = ' + String(calls(state, doc).length))
    note(label, { consumed: consumed.queue, calls: calls(state, doc).length, urlAfterTaint: urlAfterTaint.replace(ORIGIN, ''), replaceLog: expectCleanUrl ? undefined : replaceLog })
  } finally {
    await context.close()
  }
}

export async function P14b({ browser, expect, note }) {
  await dirtyDuringLoad(browser, expect, note, '(1) hash at exec', { dirtyOnExec: 'hash' }, false, true)
  await dirtyDuringLoad(browser, expect, note, '(2) replaceState at exec', { dirtyOnExec: 'replace' }, false, false)
  await dirtyDuringLoad(browser, expect, note, '(3) slow response', { delayMs: 5000 }, true, true)
}

export async function P14c({ browser, expect, note }) {
  const { context, page, state } = await openContext(browser)
  try {
    const doc = await gotoLoad(page, ORIGIN + '/')
    await waitForInit(state, doc)
    await sleep(2000)
    const before = calls(state, doc).length
    await page.evaluate(() => {
      location.hash = '#PRIVATE_H6'
    })
    await sleep(1000)
    const urlAfter = page.url()
    await internalNav(page, '/products')
    await internalNav(page, '/product/' + String(METER_ID))
    await sleep(2000)
    const after = calls(state, doc).length
    expect(!urlAfter.includes('PRIVATE_'), 'url not cleaned: ' + urlAfter)
    expect(after === before, 'events after taint: ' + String(before) + ' -> ' + String(after))
    note('evidence', { before, after, urlAfter: urlAfter.replace(ORIGIN, '') })
  } finally {
    await context.close()
  }
}

/** الترتيب: الخانة فاضية (البناء) ← غلط ← صالح ← P11 في الآخر لأنها بتغيّر الـ ID. */
export const CASES = [
  ['P01', P01, ''],
  ['P02', P02, ''],
  ['P03', P03, VALID_ID],
  ['P04', P04, VALID_ID],
  ['P05', P05, VALID_ID],
  ['P06', P06, VALID_ID],
  ['P07', P07, VALID_ID],
  ['P08', P08, VALID_ID],
  ['P09', P09, VALID_ID],
  ['P10', P10, VALID_ID],
  ['P12', P12, VALID_ID],
  ['P12ب', P12b, VALID_ID],
  ['P13', P13, VALID_ID],
  ['P14أ', P14a, VALID_ID],
  ['P14ب', P14b, VALID_ID],
  ['P14ج', P14c, VALID_ID],
  ['P11', P11, VALID_ID],
]
