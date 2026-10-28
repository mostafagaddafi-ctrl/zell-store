'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BUY_NOW_INITIAL,
  BUY_NOW_SLOW_MS,
  buyNowBusy,
  buyNowClick,
  buyNowRestored,
  buyNowRetry,
  buyNowSlow,
  type BuyNowPhase,
  type BuyNowState,
} from '../../lib/buy/buyNow'

export type BuyNow = {
  phase: BuyNowPhase
  busy: boolean
  go: (key: string, alreadyInCart: boolean, addLine: () => void, addExtras?: () => void) => void
  retry: () => void
}

/**
 * BUY-NOW — الهوك اللي بيشغّل آلة الحالة (lib/buy/buyNow.ts) في صفحة المنتج.
 * الحالة في ref علشان ضغطتين في نفس اللحظة (قبل أي render) مايعدّوش الاتنين، ونسخة في state للعرض.
 * المؤقّت بيعلّم «slow» بس (تنبيه)، ومابيفكّش الحماية أبدًا. «افتح صفحة بيانات الطلب» = تحميل كامل للصفحة.
 */
export function useBuyNow(href = '/checkout'): BuyNow {
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
    // رجوع من كاش المتصفح وهي مشغولة = الأزرار ترجع شغّالة
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

  const go: BuyNow['go'] = (key, alreadyInCart, addLine, addExtras) => {
    const step = buyNowClick(stateRef.current, key, alreadyInCart)
    if (step.navigate !== 'soft') return
    if (step.addLine) addLine()
    if (step.addExtras && addExtras) addExtras()
    commit(step.next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(buyNowSlow(stateRef.current)), BUY_NOW_SLOW_MS)
    startTransition(() => {
      router.push(href)
    })
  }

  const retry = () => {
    const step = buyNowRetry(stateRef.current)
    if (step.navigate !== 'hard') return
    commit(step.next)
    window.location.assign(href)
  }

  return { phase: state.phase, busy: buyNowBusy(state), go, retry }
}
