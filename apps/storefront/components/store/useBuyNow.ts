'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BUY_NOW_INITIAL,
  BUY_NOW_TIMEOUT_MS,
  buyNowClick,
  buyNowRestored,
  buyNowTimeout,
  type BuyNowPhase,
  type BuyNowState,
} from '../../lib/buy/buyNow'

/**
 * BUY-NOW — الهوك اللي بيشغّل آلة الحالة (lib/buy/buyNow.ts) في صفحة المنتج.
 * الحالة في ref علشان ضغطتين في نفس اللحظة (قبل أي render) مايعدّوش الاتنين، ونسخة في state للعرض.
 */
export function useBuyNow(href = '/checkout'): { phase: BuyNowPhase; go: (key: string, alreadyInCart: boolean, addToCart: () => void) => void } {
  const router = useRouter()
  const stateRef = useRef<BuyNowState>(BUY_NOW_INITIAL)
  const [state, setState] = useState<BuyNowState>(BUY_NOW_INITIAL)
  const [, startTransition] = useTransition()
  const timer = useRef<number | undefined>(undefined)

  const commit = (next: BuyNowState) => {
    stateRef.current = next
    setState(next)
  }

  useEffect(() => {
    // رجوع من كاش المتصفح وهي لسه «بينتقل» = الأزرار ترجع شغّالة
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      window.clearTimeout(timer.current)
      const next = buyNowRestored(stateRef.current)
      stateRef.current = next
      setState(next)
    }
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('pageshow', onShow)
      window.clearTimeout(timer.current)
    }
  }, [])

  const go = (key: string, alreadyInCart: boolean, addToCart: () => void) => {
    const step = buyNowClick(stateRef.current, key, alreadyInCart)
    if (!step.navigate) return
    if (step.add) addToCart()
    commit(step.next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(buyNowTimeout(stateRef.current)), BUY_NOW_TIMEOUT_MS)
    startTransition(() => {
      router.push(href)
    })
  }

  return { phase: state.phase, go }
}
