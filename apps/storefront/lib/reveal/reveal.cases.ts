/**
 * ADD-REVEAL — حالات التحريك لرسالة «اتضاف للسلة» (pnpm --filter @zell/storefront cases، suite reveal).
 * G = الحساب (الحدود الفعلية بين الهيدر وشريط السلة وsafe-area · ظاهر عند الحواف الفعلية وجوه منطقة الهامش = صفر ·
 *     بكسل واحد محجوب · تحت · فوق · أطول من المساحة). الهامش في وجهة التحريك بس.
 * R = التشغيل ببيئة مزيّفة (scroll وfocus وترتيبهم · reduced motion · التكرار).
 * W = الربط في الملفات: الـ hook بيقيس الشريط والهيدر فعليًا ومابيستعملش scrollIntoView، وreveal في «ضيف للسلة» بس
 *     (بعد الإضافة الناجحة، ومش في «اطلب دلوقتي»)، والصندوق قابل للتركيز. ده فحص نص الملفات، مش متصفح.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REVEAL_GAP_PX, revealBounds, revealDelta, runReveal, type RevealEnv } from './reveal'

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
  check('G01 actual bounds between the sticky header and the cart bar (no gap)', revealBounds(800, 64, 685), { top: 64, bottom: 685 })
  check('G02 bounds without header or bar = the screen', revealBounds(800, null, null), { top: 0, bottom: 800 })
  const b = revealBounds(800, 64, 685)
  check('G03 box fully below the bar: scroll so it ends 8px above the bar', revealDelta({ top: 700, bottom: 900 }, b), 223)
  check('G04 box partly behind the bar: scroll so it ends 8px above the bar', revealDelta({ top: 600, bottom: 760 }, b), 83)
  check('G05 box ending exactly at the bar top: visible, no scroll', revealDelta({ top: 500, bottom: 685 }, b), 0)
  check('G06 box starting exactly at the header bottom: visible, no scroll', revealDelta({ top: 64, bottom: 300 }, b), 0)
  check('G07 box 500–678 between header 64 and bar 685: visible, no scroll', revealDelta({ top: 500, bottom: 678 }, b), 0)
  check('G08 box inside the gap zone near the bar (bottom 684): visible, no scroll', revealDelta({ top: 600, bottom: 684 }, b), 0)
  check('G09 one pixel behind the bar (bottom 686): scroll to 8px above the bar', revealDelta({ top: 500, bottom: 686 }, b), 9)
  check('G10 one pixel under the header (top 63): scroll up to 8px under the header', revealDelta({ top: 63, bottom: 200 }, b), -9)
  check('G11 box above (under the header): scroll up', revealDelta({ top: 40, bottom: 200 }, b), -32)
  check('G12 box taller than the area and hidden: its top goes 8px under the header', revealDelta({ top: 100, bottom: 800 }, b), 28)
  // نفس الصندوق، والفرق في safe-area بس: شريط من غير safe-area (81) = ظاهر، ومع 34 (115) = محجوب ولازم ينزل
  check('G13 the measured bar (safe-area) decides', [revealDelta({ top: 560, bottom: 700 }, revealBounds(800, 64, 800 - 81)), revealDelta({ top: 560, bottom: 700 }, revealBounds(800, 64, 800 - 115))], [0, 23])

  const r1 = env()
  check('R01 visible: no scroll, focus only', [runReveal({ top: 300, bottom: 500 }, r1.e), r1.calls], [0, ['focus']])
  const r1b = env()
  check('R02 visible at the actual edges (64 and 685): no scroll, focus only', [runReveal({ top: 64, bottom: 685 }, r1b.e), r1b.calls], [0, ['focus']])
  const r2 = env()
  check('R03 hidden: one smooth scroll, then focus', [runReveal({ top: 700, bottom: 900 }, r2.e), r2.calls], [223, ['scroll:223:smooth', 'focus']])
  const r3 = env({ reducedMotion: true })
  check('R04 reduced motion: instant scroll', [runReveal({ top: 700, bottom: 900 }, r3.e), r3.calls], [223, ['scroll:223:auto', 'focus']])
  const r4 = env()
  runReveal({ top: 700, bottom: 900 }, r4.e)
  runReveal({ top: 477, bottom: 677 }, r4.e)
  check('R05 repeated add: each reveal measures again (second one already visible = no scroll)', r4.calls, ['scroll:223:smooth', 'focus', 'focus'])
  const r5 = env({ headerBottom: null, barTop: null })
  check('R06 empty cart (no bar) and no pinned header: visible to the screen edge = no scroll', [runReveal({ top: 700, bottom: 800 }, r5.e), r5.calls], [0, ['focus']])
  const r6 = env({ headerBottom: null, barTop: null })
  check('R07 empty cart: past the screen edge = scroll to 8px above it', [runReveal({ top: 700, bottom: 805 }, r6.e), r6.calls], [13, ['scroll:13:smooth', 'focus']])
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
