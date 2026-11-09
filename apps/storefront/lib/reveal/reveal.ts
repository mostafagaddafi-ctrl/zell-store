/**
 * ADD-REVEAL — منطق خالص لتحريك الصفحة لرسالة «اتضاف للسلة» (من غير DOM؛ الواجهة في components/store/useRevealOnAdd.ts).
 * المساحة الظاهرة = بين أسفل الهيدر الثابت (sticky) وأعلى شريط السلة الثابت (CartBar)، أو حدود الشاشة لو مش موجودين،
 * ومعاها هامش صغير. شريط السلة بيتقاس فعليًا (ارتفاعه فيه safe-area-inset-bottom)، مش رقم ثابت.
 * الصندوق جوه المساحة كله = مفيش تحريك خالص. أكبر من المساحة = أوله يبان تحت الهيدر.
 */

export type RevealBox = { top: number; bottom: number }
export type RevealArea = { top: number; bottom: number }

/** الهامش بين الصندوق وحدود المساحة (px). */
export const REVEAL_GAP_PX = 8

export function revealArea(viewportHeight: number, headerBottom: number | null, barTop: number | null, gap: number = REVEAL_GAP_PX): RevealArea {
  const top = Math.max(0, headerBottom ?? 0) + gap
  const bottom = Math.min(viewportHeight, barTop ?? viewportHeight) - gap
  return { top, bottom }
}

/** 0 = الصندوق ظاهر كله، مفيش تحريك. غير كده = المسافة لـ window.scrollBy (موجب لتحت، سالب لفوق). */
export function revealDelta(box: RevealBox, area: RevealArea): number {
  if (box.top >= area.top && box.bottom <= area.bottom) return 0
  if (box.bottom - box.top > area.bottom - area.top) return box.top - area.top
  if (box.bottom > area.bottom) return box.bottom - area.bottom
  return box.top - area.top
}

export type RevealEnv = {
  viewportHeight: number
  headerBottom: number | null
  barTop: number | null
  reducedMotion: boolean
  scrollBy: (top: number, behavior: 'smooth' | 'auto') => void
  focus: () => void
}

/** التحريك لو لازم بس (ناعم، أو فوري مع reduced motion)، وبعده التركيز دايمًا (الواجهة بتعمله بـ preventScroll). */
export function runReveal(box: RevealBox, env: RevealEnv): number {
  const delta = revealDelta(box, revealArea(env.viewportHeight, env.headerBottom, env.barTop))
  if (delta !== 0) env.scrollBy(delta, env.reducedMotion ? 'auto' : 'smooth')
  env.focus()
  return delta
}
