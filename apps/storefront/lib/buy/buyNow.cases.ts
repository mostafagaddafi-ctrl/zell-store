/**
 * BUY-NOW — حالات «اطلب دلوقتي» (pnpm --filter @zell/storefront cases، suite buy-now).
 * سلة مزيّفة بتعدّ السطور والإضافات، وعدّاد انتقالات (عادي/كامل)، وساعة مزيّفة.
 * N01 أول ضغطة · N02 ضغطات سريعة · N03 بعد 15 ثانية = تنبيه والحماية فاضلة · N04 الانتقال الأصلي يكمّل بعد التنبيه ·
 * N05 «افتح صفحة بيانات الطلب» · N06 retry في غير وقته · N07 «ضيف للسلة» الأول · N08 كاش المتصفح + إضافات جديدة ·
 * N09 اختيار تاني بعد الرجوع · N10 الثوابت · N11 الربط في المكوّنات (قفل الخانات · التنبيه · صفحة التحميل).
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUY_NOW_INITIAL,
  BUY_NOW_PENDING_TEXT,
  BUY_NOW_RETRY_LABEL,
  BUY_NOW_SLOW_MS,
  BUY_NOW_SLOW_TEXT,
  buyNowBusy,
  buyNowClick,
  buyNowRestored,
  buyNowRetry,
  buyNowSlow,
  type BuyNowState,
  type BuyNowStep,
} from './buyNow'

export type BuyNowCaseFailure = { name: string; expected: string; actual: string }

const failures: BuyNowCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

/** محاكاة الصفحة: سلة مزيّفة + انتقالات + ساعة. selectedExtras = الإضافات المختارة دلوقتي (بتتصفّر بعد الإضافة زي AddonsPicker). */
function page() {
  let state: BuyNowState = BUY_NOW_INITIAL
  let now = 0
  let startedAt = 0
  let selectedExtras = 0
  const cart = { lines: 0, extras: 0 }
  const nav = { soft: 0, hard: 0 }
  const apply = (step: BuyNowStep) => {
    if (step.addLine) cart.lines += 1
    if (step.addExtras) {
      cart.extras += selectedExtras
      selectedExtras = 0
    }
    if (step.navigate === 'soft') nav.soft += 1
    if (step.navigate === 'hard') nav.hard += 1
    state = step.next
  }
  return {
    select(extras: number) {
      selectedExtras = extras
    },
    click(key: string, alreadyInCart = false) {
      const step = buyNowClick(state, key, alreadyInCart)
      if (step.navigate !== 'none') startedAt = now
      apply(step)
    },
    retry() {
      apply(buyNowRetry(state))
    },
    wait(ms: number) {
      now += ms
      if (state.phase === 'navigating' && now - startedAt >= BUY_NOW_SLOW_MS) state = buyNowSlow(state)
    },
    restore() {
      state = buyNowRestored(state)
    },
    get view() {
      return { phase: state.phase, busy: buyNowBusy(state), lines: cart.lines, extras: cart.extras, soft: nav.soft, hard: nav.hard }
    },
  }
}

export function runBuyNowCases(): { passed: number; failures: BuyNowCaseFailure[] } {
  const p = page()
  p.select(2)
  p.click('300|120')
  check('N01 first click: line once + the 2 selected addons, one soft navigation, busy', p.view, { phase: 'navigating', busy: true, lines: 1, extras: 2, soft: 1, hard: 0 })

  for (let i = 0; i < 5; i += 1) p.click('300|120')
  check('N02 five rapid clicks while navigating: nothing', p.view, { phase: 'navigating', busy: true, lines: 1, extras: 2, soft: 1, hard: 0 })

  p.wait(BUY_NOW_SLOW_MS)
  for (let i = 0; i < 3; i += 1) p.click('300|120')
  check('N03 after 15s: slow notice, still busy (no unlock), clicks ignored', p.view, { phase: 'slow', busy: true, lines: 1, extras: 2, soft: 1, hard: 0 })

  p.wait(60000)
  check('N04 the original navigation may still complete: nothing changes on the page meanwhile', p.view, { phase: 'slow', busy: true, lines: 1, extras: 2, soft: 1, hard: 0 })

  p.retry()
  p.retry()
  p.retry()
  check('N05 «افتح صفحة بيانات الطلب» x3: one full page load, nothing added, still busy', p.view, { phase: 'reloading', busy: true, lines: 1, extras: 2, soft: 1, hard: 1 })

  const q = page()
  q.retry()
  q.click('300|120')
  q.retry()
  check('N06 retry when idle or still within 15s: no effect', q.view, { phase: 'navigating', busy: true, lines: 1, extras: 0, soft: 1, hard: 0 })

  const r = page()
  r.select(1)
  r.click('300|120', true)
  check('N07 «ضيف للسلة» first then buy now: line not added again; addons picked after it are added (shown = added)', r.view, { phase: 'navigating', busy: true, lines: 0, extras: 1, soft: 1, hard: 0 })

  const s = page()
  s.click('450|120')
  s.wait(BUY_NOW_SLOW_MS)
  s.restore()
  check('N08 back from the browser cache while busy: buttons enabled again', s.view, { phase: 'idle', busy: false, lines: 1, extras: 0, soft: 1, hard: 0 })
  s.select(3)
  s.click('450|120')
  check('N08 same line again: line not re-added, the 3 newly picked addons are added', s.view, { phase: 'navigating', busy: true, lines: 1, extras: 3, soft: 2, hard: 0 })

  const t = page()
  t.click('300|120')
  t.restore()
  t.click('500|150')
  check('N09 a different line after coming back is a new line (added once)', t.view, { phase: 'navigating', busy: true, lines: 2, extras: 0, soft: 2, hard: 0 })

  const idle: BuyNowState = BUY_NOW_INITIAL
  check('N10 slow/restore on idle change nothing', [buyNowSlow(idle), buyNowRestored(idle)], [idle, idle])
  check('N10 constants', [BUY_NOW_SLOW_MS, BUY_NOW_PENDING_TEXT, BUY_NOW_RETRY_LABEL, BUY_NOW_SLOW_TEXT.includes('مش هيتكرر')], [
    15000,
    'جارٍ الانتقال لبيانات الطلب…',
    'افتح صفحة بيانات الطلب',
    true,
  ])

  const root = process.cwd()
  const productBuy = readFileSync(join(root, 'components', 'store', 'ProductBuy.tsx'), 'utf8')
  const pieceBuy = readFileSync(join(root, 'components', 'store', 'PieceBuy.tsx'), 'utf8')
  const hook = readFileSync(join(root, 'components', 'store', 'useBuyNow.ts'), 'utf8')
  check('N11 ProductBuy/PieceBuy go through useBuyNow (no direct push to /checkout)', [
    productBuy.includes('useBuyNow('),
    pieceBuy.includes('useBuyNow('),
    /router\.push\(\s*['"]\/checkout/.test(productBuy + pieceBuy),
  ], [true, true, false])
  check('N11 every choice is locked while busy (fieldset disabled)', [productBuy.includes('<fieldset disabled={busy}'), pieceBuy.includes('<fieldset disabled={busy}')], [true, true])
  check('N11 slow notice + retry in both', [productBuy.includes('<BuyNowSlowNotice'), pieceBuy.includes('<BuyNowSlowNotice')], [true, true])
  check('N11 the 15s timer only marks slow (never unlocks), retry is a full page load', [hook.includes('buyNowSlow('), hook.includes('window.location.assign('), /buyNowTimeout|phase: 'failed'/.test(hook)], [true, true, false])
  check('N11 checkout has a loading screen', existsSync(join(root, 'app', 'checkout', 'loading.tsx')), true)
  const checkoutForm = readFileSync(join(root, 'components', 'store', 'CheckoutForm.tsx'), 'utf8')
  check('N12 checkout shows «تعديل السلة» (link to /cart) above the items', /<Link href="\/cart"[^>]*>\s*تعديل السلة\s*<\/Link>/.test(checkoutForm), true)

  return { passed, failures }
}
