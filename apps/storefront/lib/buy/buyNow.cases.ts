/**
 * BUY-NOW — حالات «اطلب دلوقتي» (pnpm --filter @zell/storefront cases، suite buy-now).
 * سلة مزيّفة بتعدّ الإضافات (الصنف + إضافاته في نفس الخطوة) والانتقالات، ووقت مزيّف للانتقال البطيء والفشل.
 * N01 أول ضغطة · N02 ضغطات سريعة متكررة · N03 انتقال بطيء · N04 فشل · N05 إعادة المحاولة · N06 ضغطات سريعة وقت الإعادة ·
 * N07 «ضيف للسلة» الأول · N08 رجوع من كاش المتصفح · N09 اختيار تاني بعد الفشل · N10 حالات من غير أثر ·
 * N11 الثوابت · N12 الربط في المكوّنات وصفحة التحميل.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUY_NOW_FAILED_TEXT,
  BUY_NOW_INITIAL,
  BUY_NOW_PENDING_TEXT,
  BUY_NOW_TIMEOUT_MS,
  buyNowBusy,
  buyNowClick,
  buyNowRestored,
  buyNowTimeout,
  type BuyNowState,
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

/** محاكاة الصفحة: سلة مزيّفة + عدّاد انتقالات + ساعة. */
function page() {
  let state: BuyNowState = BUY_NOW_INITIAL
  let now = 0
  let startedAt = 0
  const cart = { lines: 0, addons: 0 }
  let navigations = 0
  return {
    click(key: string, alreadyInCart = false, addonCount = 0) {
      const step = buyNowClick(state, key, alreadyInCart)
      if (!step.navigate) return
      if (step.add) {
        cart.lines += 1
        cart.addons += addonCount
      }
      state = step.next
      startedAt = now
      navigations += 1
    },
    wait(ms: number) {
      now += ms
      if (state.phase === 'navigating' && now - startedAt >= BUY_NOW_TIMEOUT_MS) state = buyNowTimeout(state)
    },
    restore() {
      state = buyNowRestored(state)
    },
    get view() {
      return { phase: state.phase, busy: buyNowBusy(state), lines: cart.lines, addons: cart.addons, navigations }
    },
  }
}

export function runBuyNowCases(): { passed: number; failures: BuyNowCaseFailure[] } {
  const p = page()
  p.click('300|120', false, 2)
  check('N01 first click: adds the item and its 2 addons once, navigates, busy', p.view, { phase: 'navigating', busy: true, lines: 1, addons: 2, navigations: 1 })

  for (let i = 0; i < 5; i += 1) p.click('300|120', false, 2)
  check('N02 five rapid clicks while navigating: nothing added, no extra navigation', p.view, { phase: 'navigating', busy: true, lines: 1, addons: 2, navigations: 1 })

  p.wait(BUY_NOW_TIMEOUT_MS - 1)
  p.click('300|120', false, 2)
  check('N03 slow navigation (just under the timeout): still busy, clicks ignored', p.view, { phase: 'navigating', busy: true, lines: 1, addons: 2, navigations: 1 })

  p.wait(1)
  check('N04 timeout: failed, buttons enabled, item still in the cart once', p.view, { phase: 'failed', busy: false, lines: 1, addons: 2, navigations: 1 })

  p.click('300|120', false, 2)
  check('N05 retry with the same choice: navigates again without adding', p.view, { phase: 'navigating', busy: true, lines: 1, addons: 2, navigations: 2 })

  for (let i = 0; i < 3; i += 1) p.click('300|120', false, 2)
  check('N06 rapid clicks during the retry: still one item, two navigations', p.view, { phase: 'navigating', busy: true, lines: 1, addons: 2, navigations: 2 })

  const q = page()
  q.click('2', true)
  check('N07 «ضيف للسلة» first, then buy now: no second add, navigates (old behavior)', q.view, { phase: 'navigating', busy: true, lines: 0, addons: 0, navigations: 1 })

  const r = page()
  r.click('450|120')
  r.restore()
  check('N08 back from the browser cache while navigating: buttons enabled again', r.view, { phase: 'idle', busy: false, lines: 1, addons: 0, navigations: 1 })
  r.click('450|120')
  check('N08 then buy now with the same choice: no second add', r.view, { phase: 'navigating', busy: true, lines: 1, addons: 0, navigations: 2 })

  const s = page()
  s.click('300|120')
  s.wait(BUY_NOW_TIMEOUT_MS)
  s.click('500|150')
  check('N09 after a failure, a different choice is a new item (added once)', s.view, { phase: 'navigating', busy: true, lines: 2, addons: 0, navigations: 2 })

  check('N10 timeout/restore when idle change nothing', [buyNowTimeout(BUY_NOW_INITIAL), buyNowRestored(BUY_NOW_INITIAL)], [BUY_NOW_INITIAL, BUY_NOW_INITIAL])
  const failed: BuyNowState = { phase: 'failed', addedKey: 'k' }
  check('N10 restore when failed keeps failed', buyNowRestored(failed), failed)

  check('N11 constants', [BUY_NOW_TIMEOUT_MS, BUY_NOW_PENDING_TEXT, BUY_NOW_FAILED_TEXT.length > 20], [15000, 'جارٍ الانتقال لبيانات الطلب…', true])

  const root = process.cwd()
  const productBuy = readFileSync(join(root, 'components', 'store', 'ProductBuy.tsx'), 'utf8')
  const pieceBuy = readFileSync(join(root, 'components', 'store', 'PieceBuy.tsx'), 'utf8')
  check('N12 ProductBuy and PieceBuy go through useBuyNow (no direct push to /checkout)', [
    productBuy.includes('useBuyNow('),
    pieceBuy.includes('useBuyNow('),
    /router\.push\(\s*['"]\/checkout/.test(productBuy + pieceBuy),
  ], [true, true, false])
  check('N12 both disable «ضيف للسلة» while navigating', [productBuy.includes('disabled={!canAdd || busy}'), pieceBuy.includes('disabled={busy}')], [true, true])
  check('N12 checkout has a loading screen', existsSync(join(root, 'app', 'checkout', 'loading.tsx')), true)

  return { passed, failures }
}
