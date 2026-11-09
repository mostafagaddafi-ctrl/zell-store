/**
 * ADD-REVEAL — منطق خالص لتحريك الصفحة لرسالة «اتضاف للسلة» (من غير DOM؛ الواجهة في components/store/useRevealOnAdd.ts).
 * الحدود الفعلية = بين أسفل الهيدر الثابت (sticky) وأعلى شريط السلة الثابت (CartBar)، أو حدود الشاشة لو مش موجودين.
 * شريط السلة بيتقاس فعليًا (ارتفاعه فيه safe-area-inset-bottom)، مش رقم ثابت.
 * قرار التحريك من الحدود الفعلية بس: الصندوق جواها كله = مفيش تحريك خالص (حتى لو لازق في الحافة).
 * الهامش (REVEAL_GAP_PX) بيتحسب بس في وجهة التحريك لما الصندوق محجوب فعلًا، ومابيمنعش ظهوره كله: الصندوق اللي يساع الحدود
 * الفعلية بيفضل جواها كله بعد التحريك حتى لو الهامش قلّ عن 8. أطول من الحدود الفعلية بس = أوله يبان تحت الهيدر بالهامش.
 */

export type RevealBox = { top: number; bottom: number }
export type RevealBounds = { top: number; bottom: number }

/** الهامش بين الصندوق وحدود المساحة في وجهة التحريك بس (px). */
export const REVEAL_GAP_PX = 8

/** الحدود الفعلية للمساحة الظاهرة (من غير هامش). */
export function revealBounds(viewportHeight: number, headerBottom: number | null, barTop: number | null): RevealBounds {
  return { top: Math.max(0, headerBottom ?? 0), bottom: Math.min(viewportHeight, barTop ?? viewportHeight) }
}

/**
 * 0 = الصندوق ظاهر كله جوه الحدود الفعلية. غير كده = المسافة لـ window.scrollBy (موجب لتحت، سالب لفوق).
 * يساع الحدود الفعلية = الوجهة بالهامش، بس مقيّدة علشان الحافتين يفضلوا جوه الحدود (الهامش ممكن يقل).
 * أطول من الحدود الفعلية = أوله تحت الهيدر بالهامش.
 */
export function revealDelta(box: RevealBox, bounds: RevealBounds, gap: number = REVEAL_GAP_PX): number {
  if (box.top >= bounds.top && box.bottom <= bounds.bottom) return 0
  if (box.bottom - box.top > bounds.bottom - bounds.top) return box.top - (bounds.top + gap)
  // تحت: آخره قبل الشريط بالهامش، من غير ما أوله يطلع فوق الهيدر
  if (box.bottom > bounds.bottom) return Math.min(box.bottom - (bounds.bottom - gap), box.top - bounds.top)
  // فوق: أوله بعد الهيدر بالهامش، من غير ما آخره ينزل ورا الشريط
  return Math.max(box.top - (bounds.top + gap), box.bottom - bounds.bottom)
}

export type RevealEnv = {
  viewportHeight: number
  headerBottom: number | null
  barTop: number | null
  reducedMotion: boolean
  scrollBy: (top: number, behavior: 'smooth' | 'auto') => void
  focus: () => void
}

/** التحريك لو الصندوق محجوب فعلًا بس (ناعم، أو فوري مع reduced motion)، وبعده التركيز دايمًا (الواجهة بتعمله بـ preventScroll). */
export function runReveal(box: RevealBox, env: RevealEnv): number {
  const delta = revealDelta(box, revealBounds(env.viewportHeight, env.headerBottom, env.barTop))
  if (delta !== 0) env.scrollBy(delta, env.reducedMotion ? 'auto' : 'smooth')
  env.focus()
  return delta
}
