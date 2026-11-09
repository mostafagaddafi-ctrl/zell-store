'use client'

import { useEffect, useRef, useState } from 'react'
import { runReveal } from '../../lib/reveal/reveal'

/**
 * ADD-REVEAL — بعد «ضيف للسلة» رسالة «اتضاف للسلة» بتظهر تحت الأزرار، والصفحة كانت مابتتحركش لها. reveal() بعد
 * الإضافة: بنقيس الصندوق والهيدر الثابت وشريط السلة الثابت (data-cart-bar، وارتفاعه فيه safe-area) فعليًا، والصفحة
 * بتتحرك بس لو الصندوق مش ظاهر كله في المساحة اللي بينهم (lib/reveal/reveal.ts)، ناعم أو فوري مع reduced motion.
 * والتركيز بيروح للصندوق (tabIndex -1) بـ preventScroll علشان قارئ الشاشة. مابيلمسش السلة ولا الأسعار.
 */
export function useRevealOnAdd<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (tick === 0) return
    const node = ref.current
    if (!node) return
    const box = node.getBoundingClientRect()
    const header = document.querySelector('header')
    const pinned = header !== null && ['sticky', 'fixed'].includes(window.getComputedStyle(header).position)
    const bar = document.querySelector<HTMLElement>('[data-cart-bar]')
    runReveal(
      { top: box.top, bottom: box.bottom },
      {
        viewportHeight: window.innerHeight,
        headerBottom: header !== null && pinned ? header.getBoundingClientRect().bottom : null,
        barTop: bar !== null ? bar.getBoundingClientRect().top : null,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        scrollBy: (top, behavior) => window.scrollBy({ top, behavior }),
        focus: () => node.focus({ preventScroll: true }),
      },
    )
  }, [tick])
  return { ref, reveal: () => setTick((value) => value + 1) }
}
