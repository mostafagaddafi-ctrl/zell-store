/**
 * ADD-REVEAL — حالات التحريك لرسالة «اتضاف للسلة» (pnpm --filter @zell/storefront cases، suite reveal).
 * G = الحساب (المساحة بين الهيدر وشريط السلة وsafe-area · ظاهر عند الحواف · تحت · فوق · أطول من المساحة).
 * R = التشغيل ببيئة مزيّفة (scroll وfocus وترتيبهم · reduced motion · التكرار).
 * W = الربط في الملفات: الـ hook بيقيس الشريط والهيدر فعليًا ومابيستعملش scrollIntoView، وreveal في «ضيف للسلة» بس
 *     (بعد الإضافة الناجحة، ومش في «اطلب دلوقتي»)، والصندوق قابل للتركيز. ده فحص نص الملفات، مش متصفح.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REVEAL_GAP_PX, revealArea, revealDelta, runReveal, type RevealEnv } from './reveal'

export type RevealCaseFailure = { name: string; expected: string; actual: string }

const failures: RevealCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

function env(over: Partial<RevealEnv> = {}) {
  const calls: string[] = []
  const e: RevealEnv = {
    viewportHeight: 800,
    headerBottom: 64,
    barTop: 800 - 115,
    reducedMotion: false,
    scrollBy: (top, behavior) => calls.push('scroll:' + top + ':' + behavior),
    focus: () => calls.push('focus'),
    ...over,
  }
  return { e, calls }
}

function body(source: string, start: string): string {
  const i = source.indexOf(start)
  if (i < 0) return ''
  const j = source.indexOf('\n  }\n', i)
  return j < 0 ? source.slice(i) : source.slice(i, j)
}

export function runRevealCases(): { passed: number; failures: RevealCaseFailure[] } {
  // الشاشة 800، الهيدر الثابت لحد 64، وشريط السلة 115 (h-14 + pt-3 + safe-bottom مع safe-area 34) = بيبدأ عند 685
  check('G00 gap', REVEAL_GAP_PX, 8)
  check('G01 area between the sticky header and the cart bar', revealArea(800, 64, 685), { top: 72, bottom: 677 })
  check('G02 area without header or bar = the screen minus the gap', revealArea(800, null, null), { top: 8, bottom: 792 })
  const area = revealArea(800, 64, 685)
  check('G03 box fully below the bar: scroll down by the overflow', revealDelta({ top: 700, bottom: 900 }, area), 223)
  check('G04 box partly behind the bar: scroll so it ends above the bar', revealDelta({ top: 600, bottom: 760 }, area), 83)
  check('G05 box exactly at the bottom edge above the bar: no scroll', revealDelta({ top: 500, bottom: 677 }, area), 0)
  check('G06 box exactly under the header: no scroll', revealDelta({ top: 72, bottom: 300 }, area), 0)
  check('G07 one pixel behind the bar: scroll 1', revealDelta({ top: 500, bottom: 678 }, area), 1)
  check('G08 box above (under the header): scroll up', revealDelta({ top: 40, bottom: 200 }, area), -32)
  check('G09 box taller than the area: its top goes under the header', revealDelta({ top: 100, bottom: 800 }, area), 28)
  // نفس الصندوق، والفرق في safe-area بس: شريط من غير safe-area (81) = ظاهر، ومع 34 (115) = لازم ينزل
  check('G10 the measured bar (safe-area) decides', [revealDelta({ top: 560, bottom: 700 }, revealArea(800, 64, 800 - 81)), revealDelta({ top: 560, bottom: 700 }, revealArea(800, 64, 800 - 115))], [0, 23])

  const r1 = env()
  check('R01 visible: no scroll, focus only', [runReveal({ top: 300, bottom: 500 }, r1.e), r1.calls], [0, ['focus']])
  const r2 = env()
  check('R02 hidden: one smooth scroll, then focus', [runReveal({ top: 700, bottom: 900 }, r2.e), r2.calls], [223, ['scroll:223:smooth', 'focus']])
  const r3 = env({ reducedMotion: true })
  check('R03 reduced motion: instant scroll', [runReveal({ top: 700, bottom: 900 }, r3.e), r3.calls], [223, ['scroll:223:auto', 'focus']])
  const r4 = env()
  runReveal({ top: 700, bottom: 900 }, r4.e)
  runReveal({ top: 477, bottom: 677 }, r4.e)
  check('R04 repeated add: each reveal measures again (second one already visible = no scroll)', r4.calls, ['scroll:223:smooth', 'focus', 'focus'])
  const r5 = env({ headerBottom: null, barTop: null })
  check('R05 empty cart (no bar) and no pinned header: the screen edges', [runReveal({ top: 700, bottom: 795 }, r5.e), r5.calls], [3, ['scroll:3:smooth', 'focus']])

  const root = process.cwd()
  const hook = readFileSync(join(root, 'components', 'store', 'useRevealOnAdd.ts'), 'utf8')
  check('W01 hook: measures the box, the cart bar and the pinned header, honours reduced motion, focuses with preventScroll, no scrollIntoView', [
    hook.includes('getBoundingClientRect()'),
    hook.includes("querySelector<HTMLElement>('[data-cart-bar]')"),
    hook.includes("querySelector('header')") && hook.includes('getComputedStyle(header).position'),
    hook.includes("matchMedia('(prefers-reduced-motion: reduce)')"),
    hook.includes('focus({ preventScroll: true })'),
    hook.includes('runReveal('),
    hook.includes('scrollIntoView'),
  ], [true, true, true, true, true, true, false])
  const bar = readFileSync(join(root, 'components', 'store', 'CartBar.tsx'), 'utf8')
  check('W02 the fixed cart bar carries data-cart-bar', /<div data-cart-bar="" className="safe-bottom fixed inset-x-0 bottom-0/.test(bar), true)
  for (const [file, guard] of [['ProductBuy.tsx', true], ['PieceBuy.tsx', false]] as const) {
    const src = readFileSync(join(root, 'components', 'store', file), 'utf8')
    const add = body(src, 'const handleAdd = () => {')
    const buy = body(src, 'const handleBuyNow = () => {')
    const iSet = add.indexOf('setJustAdded(true)')
    const iRev = add.indexOf('addedBox.reveal()')
    const iRet = add.indexOf("if (decision.kind !== 'add') return")
    check('W03 ' + file + ': reveal only after a successful «ضيف للسلة», never in «اطلب دلوقتي», box focusable', [
      (src.match(/addedBox\.reveal\(\)/g) ?? []).length,
      iSet >= 0 && iRev > iSet,
      guard ? iRet >= 0 && iRet < iRev : true,
      // «اطلب دلوقتي» فيه decision.kind === 'reveal' (رسالة المقاس، مالهاش علاقة) — المطلوب إن addedBox مايتناداش فيه
      buy.length > 0 && !buy.includes('addedBox'),
      /<div ref=\{addedBox\.ref\} tabIndex=\{-1\} className="[^"]*outline-none">/.test(src),
      src.includes('scroll-mb-'),
    ], [1, true, true, true, true, false])
  }

  return { passed, failures }
}
