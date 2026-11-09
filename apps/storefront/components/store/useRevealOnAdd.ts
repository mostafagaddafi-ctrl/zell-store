'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * ADD-REVEAL — بعد «ضيف للسلة» رسالة «اتضاف للسلة» بتظهر تحت الأزرار، والصفحة كانت مابتتحركش لها، فممكن تفضل
 * برّه الشاشة والعميل مايشوفهاش. reveal() بعد الإضافة: الصفحة بتنزل للرسالة بنعومة لو مش باينة كلها
 * (block: 'nearest' = مفيش حركة لو ظاهرة)، وفورًا مع reduced motion، والتركيز بيروح لها (tabIndex -1 في العنصر)
 * علشان قارئ الشاشة. العنصر عليه scroll-mb علشان مايستخباش ورا شريط السلة الثابت تحت (CartBar).
 * نفس أسلوب الأدوات في ProductBuy (revealTools). مابيلمسش السلة ولا الأسعار.
 */
export function useRevealOnAdd<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (tick === 0) return
    const node = ref.current
    if (!node) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' })
    node.focus({ preventScroll: true })
  }, [tick])
  return { ref, reveal: () => setTick((value) => value + 1) }
}
