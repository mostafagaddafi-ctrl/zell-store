'use client'

import { useCallback, useEffect, useReducer, useRef, type RefObject } from 'react'
import { normalizeCouponCode } from '@zell/core'
import {
  COUPON_NETWORK_MESSAGE,
  INITIAL_COUPON_STATE,
  couponReducer,
  parsePreviewReply,
  planApply,
  type CouponState,
  type SubmitOutcome,
} from './orders/couponCheckout'

/**
 * كوبون صفحة الطلب (0019 · PR4) — الربط بين الحالة الخالصة (orders/couponCheckout) والشبكة.
 *
 * 🔒 المعاينة بس من هنا (POST /api/coupons/preview). مفيش أي مبلغ بيتبعت أو بيتحفظ، والكود
 *    مابيتعتبرش مطبّق غير بعد رد معاينة ناجح لنفس الكود.
 * ⚠️ ضغطة واحدة في اللحظة: الزرار بيتقفل وقت المعاينة، و busyRef بيمنع ضغطتين قبل ما الحالة تتحدّث.
 */

const PREVIEW_TIMEOUT_MS = 10000

export type CheckoutCoupon = {
  state: CouponState
  /** رسالة فشل التطبيق — بتاخد الفوكس بعد ضغطة «تطبيق» فاشلة بس (مش وقت الاسترجاع). */
  errorRef: RefObject<HTMLParagraphElement | null>
  toggle: () => void
  setInput: (value: string) => void
  apply: () => void
  remove: () => void
  /** كود المسودة — معاينة جديدة مرة واحدة، ومش مطبّق قبل نجاحها. */
  restore: (code: string) => void
  submitStart: () => void
  submitOutcome: (outcome: SubmitOutcome) => void
}

export function useCheckoutCoupon(): CheckoutCoupon {
  const [state, dispatch] = useReducer(couponReducer, INITIAL_COUPON_STATE)
  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const focusErrorRef = useRef(false)
  const errorRef = useRef<HTMLParagraphElement | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (state.phase !== 'error' || !focusErrorRef.current) return
    focusErrorRef.current = false
    errorRef.current?.focus()
  }, [state.phase, state.error])

  const preview = useCallback(async (code: string): Promise<void> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    busyRef.current = true
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, PREVIEW_TIMEOUT_MS)

    try {
      const response = await fetch('/api/coupons/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        // zell_ck لازم توصل — المعاينة بتطلب جلسة الدفع زي الطلب
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      })
      const json: unknown = await response.json().catch(() => null)
      const reply = parsePreviewReply(json, code)
      dispatch(reply.ok ? { type: 'preview_ok', code, terms: reply.terms } : { type: 'preview_failed', code, message: reply.message })
    } catch (error) {
      // إلغاء مقصود (معاينة أحدث أو الصفحة اتقفلت) → ولا حاجة. المهلة → رسالة شبكة.
      if (error instanceof Error && error.name === 'AbortError' && !timedOut) return
      dispatch({ type: 'preview_failed', code, message: COUPON_NETWORK_MESSAGE })
    } finally {
      clearTimeout(timer)
      if (abortRef.current === controller) busyRef.current = false
    }
  }, [])

  const apply = useCallback(() => {
    if (busyRef.current) return
    const plan = planApply(state)
    if (plan.kind === 'busy') return
    focusErrorRef.current = true
    if (plan.kind === 'invalid') {
      dispatch({ type: 'apply_invalid' })
      return
    }
    dispatch({ type: 'apply_start', code: plan.code })
    void preview(plan.code)
  }, [state, preview])

  const restore = useCallback(
    (code: string) => {
      const normalized = normalizeCouponCode(code)
      if (normalized === null) return
      dispatch({ type: 'restore', code: normalized })
      void preview(normalized)
    },
    [preview],
  )

  return {
    state,
    errorRef,
    toggle: () => dispatch({ type: 'toggle' }),
    setInput: (value: string) => dispatch({ type: 'input', value }),
    apply,
    remove: () => dispatch({ type: 'remove' }),
    restore,
    submitStart: () => dispatch({ type: 'submit_start' }),
    submitOutcome: (outcome: SubmitOutcome) => dispatch({ type: 'submit_outcome', outcome }),
  }
}
