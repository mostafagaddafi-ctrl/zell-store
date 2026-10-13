'use client'

import { useEffect, useRef, useState } from 'react'
import type { SaveState } from '../enums'
import type { MutationErrorCode, MutationResult } from '../mutations'

/**
 * هوك موحّد لكل نداءات الحفظ في اللوحة.
 *
 * ليه واحد لكل الشاشات: عشان التعارض والصلاحية وانتهاء الجلسة يتعاملوا
 * بنفس الطريقة في كل مكان. أي شاشة بتتعامل لوحدها كانت هتختلف بالتدريج.
 *
 * ⚠️ الهوك **مابيعملش** refresh تلقائي. كل مكوّن بيحدّد سلوك النجاح
 * بنفسه عن طريق onSuccess — الإنشاء محتاج router.replace، والباقي
 * محتاج router.refresh، وبعض العمليات مش محتاجة حاجة.
 */

export type SaveFailure = { code: MutationErrorCode; message: string }

export type RunOptions<T> = { onSuccess?: (data: T) => void }

/**
 * «اتحفظ» تفضل ظاهرة المدة دي قبل الرجوع لـ idle.
 * السبب: بعد النجاح بنعمل refresh، والـ props الجديدة بتوصل فورًا
 * تقريبًا. من غير التأخير ده المستخدم مش هيلاحظ إن الحفظ نجح أصلًا.
 */
const SAVED_VISIBLE_MS = 1800

const UNEXPECTED = 'حصل خطأ غير متوقع. حاول تاني، ولو اتكرر بلّغ.'

export function useSaveAction() {
  const [state, setState] = useState<SaveState>('idle')
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const retryRef = useRef<(() => void) | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      const timer = timerRef.current
      if (timer) clearTimeout(timer)
    }
  }, [])

  function clearTimer() {
    const timer = timerRef.current
    if (timer) {
      clearTimeout(timer)
      timerRef.current = null
    }
  }

  async function run<T>(action: () => Promise<MutationResult<T>>, options?: RunOptions<T>): Promise<void> {
    /**
     * «إعادة المحاولة» بتعيد **نفس** الـ thunk.
     *
     * ⚠️ عشان الإعادة تبعت أحدث draft مش نسخة متجمدة، المكوّن لازم
     * يبني الـ thunk من ref. أي thunk بيقرا متغيّر من الـ render
     * مباشرة بيبعت قيمة قديمة بعد ما المستخدم يعدّل.
     */
    retryRef.current = () => {
      void run(action, options)
    }

    clearTimer()
    setFailure(null)
    setWarning(null)
    setState('saving')

    let result: MutationResult<T>
    try {
      result = await action()
    } catch {
      // الشبكة وقعت أو الـ action نفسه رمى — مفيش تفاصيل بتتعرض
      if (!aliveRef.current) return
      setFailure({ code: 'INTERNAL', message: UNEXPECTED })
      setState('error')
      return
    }

    if (!aliveRef.current) return

    if (!result.ok) {
      setFailure({ code: result.code, message: result.message })
      setState(result.code === 'CONFLICT' ? 'conflict' : 'error')
      return
    }

    setState('saved')
    setWarning(result.warning ?? null)
    options?.onSuccess?.(result.data)

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (aliveRef.current) setState('idle')
    }, SAVED_VISIBLE_MS)
  }

  function retry() {
    const again = retryRef.current
    if (again) again()
  }

  /** بيتنادى مع كل تعديل: بيشيل بانر الفشل وبيرجّع الحالة dirty. */
  function markDirty() {
    clearTimer()
    setFailure(null)
    setWarning(null)
    setState('dirty')
  }

  function reset() {
    clearTimer()
    setFailure(null)
    setWarning(null)
    setState('idle')
  }

  return { state, failure, warning, run, retry, markDirty, reset }
}
