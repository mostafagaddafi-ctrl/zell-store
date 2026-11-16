/**
 * META-PIXEL — حالات المنطق الخالص والـ runtime ببيئة مزيّفة (pnpm --filter @zell/storefront cases، suite meta-pixel).
 * العقد: docs/contracts/META-PIXEL.md §٤-١.
 */
import { normalizeMetaPixelId } from '@zell/core'
import {
  canInit,
  classifyPath,
  cleanUrlFor,
  isBlockedPath,
  isCleanHref,
  isCleanReferrer,
  sdkReady,
  type PixelCatalog,
} from './metaPixel'
import { addToCartParams, initiateCheckoutParams, purchaseParams, viewContentParams } from './pixelEvents'
import { createPixelRuntime, PIXEL_LOAD_TIMEOUT_MS, PIXEL_QUEUE_MAX, PIXEL_SDK_SRC, type FbqLike, type PixelEnv } from './pixelRuntime'
import { decideEligibility } from './pixelBridge'

export type PixelCaseFailure = { name: string; expected: string; actual: string }

const failures: PixelCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const ORIGIN = 'https://shop.test'
const AR = 'عازل-حرارة'
const CATALOG: PixelCatalog = { productIds: new Set(['1', '2', '7']), collectionSlugs: new Set(['films', AR]) }
const ID = '1234567890123456'
const at = (path: string): string => ORIGIN + path

type FakeCall = unknown[]

/** بيئة مزيّفة: السكربت الوهمي بيستهلك الطابور وقت «التنفيذ» (execute) قبل onLoad، زي السكربت الحقيقي. */
function fakeEnv(start: string, referrer = '') {
  let href = at(start)
  const log: string[] = []
  const sdkCalls: FakeCall[] = []
  let fbq: (FbqLike & { queue?: unknown[] }) | undefined
  let idle: (() => void) | null = null
  let timer: (() => void) | null = null
  let onLoad: (() => void) | null = null
  let onError: (() => void) | null = null
  let consumed: unknown[] = []
  /** ساعة monotonic مزيّفة — المؤقّت مستقل عنها (B2). */
  let clock = 0
  const env: PixelEnv = {
    href: () => href,
    origin: ORIGIN,
    referrer,
    replaceUrl: (url) => {
      log.push('replace ' + url)
      href = ORIGIN + url
    },
    getFbq: () => fbq,
    installStub: () => {
      log.push('stub')
      const stub = ((...args: unknown[]) => {
        stub.queue?.push(args)
      }) as FbqLike & { queue?: unknown[] }
      stub.queue = []
      fbq = stub
    },
    loadScript: (src, load, error) => {
      log.push('request ' + src)
      onLoad = load
      onError = error
    },
    setTimer: (fn) => {
      timer = fn
    },
    now: () => clock,
    afterLoadIdle: (fn) => {
      idle = fn
    },
    reload: () => {
      log.push('reload')
    },
  }
  return {
    env,
    log,
    sdkCalls,
    setHref: (path: string) => {
      href = at(path)
    },
    runIdle: () => idle?.(),
    /** تنفيذ ملف السكربت: بيستهلك الطابور المؤقت ويحط callMethod (قبل onLoad). */
    execute: () => {
      const stub = fbq
      consumed = stub && Array.isArray(stub.queue) ? stub.queue.slice() : []
      const real = ((...args: unknown[]) => {
        sdkCalls.push(args)
      }) as FbqLike
      real.callMethod = () => undefined
      for (const item of consumed) sdkCalls.push(item as unknown[])
      fbq = real
    },
    consumed: () => consumed,
    load: () => onLoad?.(),
    fail: () => onError?.(),
    timeout: () => timer?.(),
    /** الوقت بيعدّي من غير ما callback المؤقّت يشتغل. */
    advance: (ms: number) => {
      clock += ms
    },
  }
}

function inits(calls: FakeCall[]): number {
  return calls.filter((c) => c[0] === 'init').length
}
function tracks(calls: FakeCall[]): string[] {
  return calls.filter((c) => c[0] === 'track').map((c) => String(c[1]))
}

export function runMetaPixelCases(): { passed: number; failures: PixelCaseFailure[] } {
  // ── الـ ID ──
  check('M01 id: empty · spaces · letters · short · long · valid · trimmed', [
    normalizeMetaPixelId(''),
    normalizeMetaPixelId('   '),
    normalizeMetaPixelId('abc1234567890'),
    normalizeMetaPixelId('123456789'),
    normalizeMetaPixelId('1'.repeat(21)),
    normalizeMetaPixelId(ID),
    normalizeMetaPixelId('  ' + ID + ' '),
    normalizeMetaPixelId(1234567890123456),
  ], ['', '', '', '', '', ID, ID, ''])

  // ── المحجوب والمسارات ──
  check('M02 blocked paths', [isBlockedPath('/order/Z1'), isBlockedPath('/track'), isBlockedPath('/track/x'), isBlockedPath('/Track'), isBlockedPath('/'), isBlockedPath('/trackx')], [true, true, true, true, false, false])
  check('M03 classify static and catalogue', [
    classifyPath('/', CATALOG),
    classifyPath('/products', CATALOG),
    classifyPath('/checkout', CATALOG),
    classifyPath('/product/7', CATALOG),
    classifyPath('/product/9', CATALOG),
    classifyPath('/product/01012345678', CATALOG),
    classifyPath('/collection/films', CATALOG),
    classifyPath('/collection/' + encodeURIComponent(AR), CATALOG),
    classifyPath('/collection/PRIVATE_SLUG_TEST', CATALOG),
    classifyPath('/policies/terms', CATALOG),
    classifyPath('/policies/other', CATALOG),
    classifyPath('/PRIVATE_NAME_TEST', CATALOG),
    classifyPath('/products/', CATALOG),
    classifyPath('/product/7/x', CATALOG),
    classifyPath('/order/Z1', CATALOG),
  ], ['clean', 'clean', 'clean', 'clean', 'unknown', 'unknown', 'clean', 'clean', 'unknown', 'clean', 'unknown', 'unknown', 'unknown', 'unknown', 'blocked'])

  // ── العنوان النضيف ──
  const c1 = cleanUrlFor(at('/?phone=PRIVATE_Q1&utm_content=PRIVATE_Q2&fbclid=TESTCLID#PRIVATE_H1'), ORIGIN, CATALOG)
  check('M04 clean: unknown query/utm/hash dropped, fbclid kept', c1, { pathOk: true, url: '/?fbclid=TESTCLID', changed: true })
  check('M05 clean: for members kept, non-member dropped, extra dropped', [
    cleanUrlFor(at('/installation-tools?for=1,2&x=PRIVATE_Q4'), ORIGIN, CATALOG),
    cleanUrlFor(at('/installation-tools?for=01012345678'), ORIGIN, CATALOG),
    cleanUrlFor(at('/products?for=1'), ORIGIN, CATALOG),
  ], [
    { pathOk: true, url: '/installation-tools?for=1,2', changed: true },
    { pathOk: true, url: '/installation-tools', changed: true },
    { pathOk: true, url: '/products', changed: true },
  ])
  check('M06 hash: #products on / only', [
    isCleanHref(at('/#products'), ORIGIN, CATALOG),
    isCleanHref(at('/products#products'), ORIGIN, CATALOG),
    isCleanHref(at('/#x'), ORIGIN, CATALOG),
  ], [true, false, false])
  check('M07 path never cleaned', [cleanUrlFor(at('/PRIVATE_NAME_TEST?x=1'), ORIGIN, CATALOG).pathOk, cleanUrlFor(at('/track?order=1'), ORIGIN, CATALOG).pathOk], [false, false])
  check('M08 fbclid shape only', [isCleanHref(at('/?fbclid=AbC_-9'), ORIGIN, CATALOG), isCleanHref(at('/?fbclid=a%40b'), ORIGIN, CATALOG), isCleanHref(at('/?fbclid=a&fbclid=b'), ORIGIN, CATALOG)], [true, false, false])

  // ── الـ referrer ──
  check('M09 referrer', [
    isCleanReferrer('', ORIGIN, CATALOG),
    isCleanReferrer(at('/products'), ORIGIN, CATALOG),
    isCleanReferrer(at('/track'), ORIGIN, CATALOG),
    isCleanReferrer(at('/track?order=PRIVATE_R1'), ORIGIN, CATALOG),
    isCleanReferrer(at('/?phone=PRIVATE_R2'), ORIGIN, CATALOG),
    isCleanReferrer(at('/PRIVATE_NAME_TEST'), ORIGIN, CATALOG),
    isCleanReferrer('https://l.facebook.com/', ORIGIN, CATALOG),
    isCleanReferrer('https://other.test/page?x=PRIVATE_R3', ORIGIN, CATALOG),
    isCleanReferrer('not a url', ORIGIN, CATALOG),
  ], [true, true, false, false, false, false, true, false, false])

  // ── الأحداث ──
  check('M10 event params keys', [Object.keys(viewContentParams(7, 'x')), Object.keys(addToCartParams(7)), initiateCheckoutParams([{ productId: 1 }, { productId: 1 }, { productId: 2 }])], [
    ['content_ids', 'content_type', 'content_name'],
    ['content_ids', 'content_type'],
    { content_ids: ['1', '2'], content_type: 'product', num_items: 3 },
  ])
  check('M11 purchase from server snapshot', [
    purchaseParams({ ok: true, order: { orderNumber: 'Z-1', totalPiastres: 123450, replayed: false, couponCode: 'X' } }, [{ productId: 1 }, { productId: 2 }]),
    purchaseParams({ ok: true, order: { orderNumber: 'Z-1', totalPiastres: 123450, replayed: true } }, [{ productId: 1 }]),
    purchaseParams({ ok: true, order: { orderNumber: 'Z-1', totalPiastres: 123450 } }, [{ productId: 1 }]),
    purchaseParams({ ok: true, order: { totalPiastres: 1.5, replayed: false } }, [{ productId: 1 }]),
    purchaseParams(null, [{ productId: 1 }]),
  ], [
    { value: 1234.5, currency: 'EGP', content_ids: ['1', '2'], content_type: 'product', num_items: 2 },
    null,
    null,
    null,
    null,
  ])

  // ── شرط التهيئة (ت١) ──
  const readyFbq = Object.assign(() => undefined, { callMethod: () => undefined })
  const stubFbq = Object.assign(() => undefined, { queue: [] as unknown[] })
  const base = { tainted: false, stopped: false, timedOut: false, hrefClean: true, referrerClean: true, id: ID, fbq: readyFbq as unknown }
  check('M12 canInit', [
    canInit(base),
    canInit({ ...base, tainted: true }),
    canInit({ ...base, hrefClean: false }),
    canInit({ ...base, referrerClean: false }),
    canInit({ ...base, timedOut: true }),
    canInit({ ...base, id: '' }),
    canInit({ ...base, fbq: stubFbq }),
    canInit({ ...base, fbq: undefined }),
  ], [true, false, false, false, false, false, false, false])
  check('M13 sdkReady: stub is not ready', [sdkReady(stubFbq), sdkReady(readyFbq), sdkReady({ callMethod: () => undefined })], [false, true, false])

  // ── الـ runtime ──
  {
    const f = fakeEnv('/?phone=PRIVATE_Q1#PRIVATE_H1')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    rt.track('PageView')
    check('R01 arm cleans before request; nothing requested before idle', [f.log, rt.phase()], [['replace /'], 'armed'])
    f.runIdle()
    check('R02 request after idle with empty stub', [f.log.slice(1), rt.phase()], [['stub', 'request ' + PIXEL_SDK_SRC], 'requested'])
    f.execute()
    check('R03 script execution consumes an empty stub queue (no ID, no init)', [f.consumed().length, inits(f.sdkCalls)], [0, 0])
    f.load()
    check('R04 t1: set + init then flush', [f.sdkCalls.map((c) => c[0]), rt.phase()], [['set', 'init', 'track'], 'ready'])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    rt.track('PageView')
    f.runIdle()
    f.setHref('/products#PRIVATE_H4')
    f.execute()
    f.load()
    check('R05 dirty before t1 (handler not run yet): no init, no events', [inits(f.sdkCalls), tracks(f.sdkCalls), rt.isTainted(), rt.phase()], [0, [], true, 'off'])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    rt.track('ViewContent', viewContentParams(1, 'x'))
    f.runIdle()
    f.setHref('/?x=PRIVATE_Q6')
    rt.onLocationChange()
    f.execute()
    f.load()
    check('R06 dirty after request start: tainted, queues emptied, nothing on load', [inits(f.sdkCalls), f.sdkCalls.length, rt.queued(), rt.isTainted()], [0, 0, 0, true])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, true)
    rt.arm(ID, CATALOG)
    f.runIdle()
    check('R07 initially tainted document never requests', [f.log, rt.isArmed()], [[], true])
  }
  {
    const f = fakeEnv('/PRIVATE_NAME_TEST')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    check('R08 unknown path: tainted, not rewritten, no request', [f.log, rt.isTainted()], [[], true])
  }
  {
    const f = fakeEnv('/', ORIGIN + '/track?order=PRIVATE_R1')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    check('R09 unclean referrer: tainted, no request', [f.log.filter((l) => l.startsWith('request')), rt.isTainted()], [[], true])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    f.execute()
    f.load()
    f.setHref('/products#PRIVATE_H6')
    rt.onLocationChange()
    rt.track('PageView')
    check('R10 dirty after init: tainted, url restored, no new events', [tracks(f.sdkCalls), rt.isTainted(), f.env.href()], [[], true, ORIGIN + '/products'])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    f.timeout()
    f.execute()
    f.load()
    check('R11 timeout: stopped, late load does not init', [inits(f.sdkCalls), rt.phase()], [0, 'off'])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    for (let i = 0; i < PIXEL_QUEUE_MAX + 5; i += 1) rt.track('PageView')
    check('R12 queue cap', rt.queued(), PIXEL_QUEUE_MAX)
    rt.updateId('')
    f.runIdle()
    check('R13 id cleared: stopped, no request', [rt.phase(), f.log.filter((l) => l.startsWith('request'))], ['off', []])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    rt.updateId('9999999999999')
    rt.arm('9999999999999', CATALOG)
    f.runIdle()
    f.execute()
    f.load()
    check('R14 second valid id ignored, single init with the pinned id', f.sdkCalls.filter((c) => c[0] === 'init'), [['init', ID]])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    f.execute()
    f.load()
    f.setHref('/order/Z1')
    rt.onLocationChange()
    check('R15 safety net: blocked path in a live document reloads', [f.log.includes('reload'), rt.isTainted()], [true, true])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    check('R16 unarmed: no full navigation', rt.needsFullNavigation(at('/track')), false)
    rt.arm(ID, CATALOG)
    check('R17 armed: blocked/unknown need full navigation, clean does not', [
      rt.needsFullNavigation(at('/track')),
      rt.needsFullNavigation(at('/order/Z1')),
      rt.needsFullNavigation(at('/product/99')),
      rt.needsFullNavigation(at('/product/1')),
      rt.needsFullNavigation(at('/#products')),
    ], [true, true, true, false, false])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    f.execute()
    f.load()
    const throwing = Object.assign(() => {
      throw new Error('boom')
    }, { callMethod: () => undefined })
    f.env.getFbq = () => throwing
    let threw = false
    try {
      rt.track('PageView')
    } catch {
      threw = true
    }
    check('R18 fbq throwing is swallowed', threw, false)
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    f.fail()
    check('R19 script error: stopped', rt.phase(), 'off')
  }

  // ── num_items = مجموع الكميات (Non-blocking (أ)، مراجعة 2b8da95) ──
  check('M14 num_items counts quantities (piece x3 = 3, meter line = 1)', [
    initiateCheckoutParams([{ productId: 2, quantity: 3 }, { productId: 1 }]),
    purchaseParams({ ok: true, order: { orderNumber: 'Z-1', totalPiastres: 100, replayed: false } }, [{ productId: 2, quantity: 3 }]),
    initiateCheckoutParams([{ productId: 2, quantity: 0 }, { productId: 3, quantity: 1.5 }]),
  ], [
    { content_ids: ['2', '1'], content_type: 'product', num_items: 4 },
    { value: 1, currency: 'EGP', content_ids: ['2'], content_type: 'product', num_items: 3 },
    { content_ids: ['2', '3'], content_type: 'product', num_items: 2 },
  ])

  // ── B2 — المهلة بالموعد المحفوظ (monotonic) مش بتنفيذ المؤقّت ──
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    rt.track('PageView')
    f.runIdle()
    f.advance(PIXEL_LOAD_TIMEOUT_MS)
    f.execute()
    f.load()
    check('R20 deadline passed, timer callback not run yet, then load: no init, no events', [inits(f.sdkCalls), tracks(f.sdkCalls), rt.phase(), rt.queued()], [0, [], 'off', 0])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    f.advance(PIXEL_LOAD_TIMEOUT_MS - 1)
    f.execute()
    f.load()
    check('R21 load just before the deadline: init', [inits(f.sdkCalls), rt.phase()], [1, 'ready'])
  }

  // ── B1 — الإيقاف مش إلغاء حراسة: بعد طلب الـ SDK الحراسة شغّالة حتى مع off ──
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    f.runIdle()
    f.execute()
    f.load()
    rt.updateId('')
    const callsAtStop = f.sdkCalls.length
    f.setHref('/products#PRIVATE')
    rt.onLocationChange()
    rt.track('PageView')
    check('R22 stopped after load: dirty hash still cleaned, no new events', [rt.phase(), rt.sdkRequested(), f.env.href(), f.sdkCalls.length - callsAtStop], ['off', true, ORIGIN + '/products', 0])
    f.setHref('/track')
    rt.onLocationChange()
    check('R23 stopped after load: blocked path still reloads (safety net)', f.log.includes('reload'), true)
    check('R24 stopped after load: blocked link still needs full navigation', rt.needsFullNavigation(at('/track')), true)
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG)
    rt.updateId('')
    f.runIdle()
    f.setHref('/products#x')
    rt.onLocationChange()
    f.setHref('/track')
    rt.onLocationChange()
    check('R25 stopped before any request: no request, no url rewrite, no reload', [rt.sdkRequested(), f.log.filter((l) => l.startsWith('request') || l.startsWith('replace /products') || l === 'reload')], [false, []])
  }

  // ── أهلية المستند (مراجعة 05a11e7): أول قيمة بتثبّت ──
  check('M15 eligibility pinned by the first value', [
    decideEligibility(null, ''),
    decideEligibility(null, ID),
    decideEligibility(false, ID),
    decideEligibility(true, ''),
    decideEligibility(true, ID),
  ], [
    { pinned: false, allowed: false },
    { pinned: true, allowed: true },
    { pinned: false, allowed: false },
    { pinned: true, allowed: false },
    { pinned: true, allowed: true },
  ])

  // ── ع١-ب — العناوين قبل التسليح ──
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG, { hrefs: [at('/?phone=PRIVATE'), at('/products')], overflow: false })
    f.runIdle()
    check('R26 unclean address before arming (not current): tainted, no request', [rt.isTainted(), f.log.filter((l) => l.startsWith('request'))], [true, []])
  }
  {
    const f = fakeEnv('/products?utm_source=x')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG, { hrefs: [at('/products?utm_source=x')], overflow: false })
    f.runIdle()
    check('R27 only the current address dirty: cleaned (n1), requested', [rt.isTainted(), f.log], [false, ['replace /products', 'stub', 'request ' + PIXEL_SDK_SRC]])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG, { hrefs: [at('/'), at('/products')], overflow: true })
    f.runIdle()
    check('R28 history over the cap (unknown): tainted, no request', [rt.isTainted(), f.log.filter((l) => l.startsWith('request'))], [true, []])
  }
  {
    const f = fakeEnv('/products')
    const rt = createPixelRuntime(f.env, false)
    rt.arm(ID, CATALOG, { hrefs: [at('/'), at('/#products'), at('/products')], overflow: false })
    f.runIdle()
    check('R29 clean history before arming: requested', [rt.isTainted(), f.log.filter((l) => l.startsWith('request')).length], [false, 1])
  }

  return { passed, failures }
}
