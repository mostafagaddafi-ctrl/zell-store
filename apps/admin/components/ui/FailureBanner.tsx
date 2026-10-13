'use client'

import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { AlertTriangle, ExternalLink, Lock, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react'
import { loginLink } from '../../lib/client/loginLink'
import type { SaveFailure } from '../../lib/client/useSaveAction'
import { Button, buttonClasses } from './Button'

/**
 * بانر الفشل — لكل كود رسالة وإجراء مختلف.
 *
 * القاعدة: المستخدم لازم يعرف **إيه اللي حصل** و**يعمل إيه بعده**.
 * رسالة "فشل" عامة بتخلي الواحد يضغط حفظ تاني بلا فايدة.
 */

const SHELL = 'space-y-2 rounded-lg border-s-2 px-3 py-2.5 text-xs leading-relaxed'
const DANGER = SHELL + ' border-danger bg-danger/5 text-fg'
const NEUTRAL = SHELL + ' border-gold bg-surface text-fg'

export function FailureBanner({
  failure,
  onRetry,
  onDiscardAndRefresh,
}: {
  failure: SaveFailure | null
  onRetry?: () => void
  onDiscardAndRefresh?: () => void
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [confirming, setConfirming] = useState(false)

  /**
   * المسار **مع** الـ query. بعض الصفحات حالتها في الـ URL (فلاتر
   * الطلبات مثلًا)، ومن غير الـ query الرجوع بعد الدخول بيروح لصفحة
   * مختلفة عن اللي المستخدم كان فيها. loginLink بتعقّم النتيجة.
   */
  const query = searchParams.toString()
  const here = query === '' ? pathname : pathname + '?' + query

  if (!failure) return null

  // انتهت الجلسة — الفورم **مايتمسحش**، والدخول بيتفتح في تبويب جديد
  if (failure.code === 'UNAUTHENTICATED') {
    return (
      <div className={DANGER} role="alert">
        <p className="flex items-center gap-1.5 font-semibold">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-danger" />
          انتهت الجلسة
        </p>
        <p className="text-muted">
          يُرجى تسجيل الدخول في تبويب جديد، ثم العودة إلى هذه الصفحة والضغط على «إعادة المحاولة». التعديلات ما زالت موجودة في الصفحة.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <a
            href={loginLink(here)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses('secondary', 'sm')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            تسجيل الدخول في تبويب جديد
          </a>
          {onRetry ? (
            <Button size="sm" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" />
              إعادة المحاولة
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (failure.code === 'FORBIDDEN') {
    return (
      <div className={DANGER} role="alert">
        <p className="flex items-center gap-1.5 font-semibold">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-danger" />
          مفيش صلاحية
        </p>
        <p className="text-muted">{failure.message} لو ده غلط، كلّم المالك.</p>
      </div>
    )
  }

  // العلم مقفول. حالة تشغيلية متوقعة — **مش** خطأ.
  if (failure.code === 'DISABLED') {
    return (
      <div className={NEUTRAL} role="status">
        <p className="flex items-center gap-1.5 font-semibold">
          <Lock className="h-3.5 w-3.5 shrink-0 text-gold" />
          التعديلات موقوفة
        </p>
        <p className="text-muted">{failure.message}</p>
      </div>
    )
  }

  if (failure.code === 'CONFLICT') {
    return (
      <div className={DANGER} role="alert">
        <p className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
          تعارض في التعديل
        </p>
        <p className="text-muted">{failure.message}</p>

        {onDiscardAndRefresh ? (
          confirming ? (
            <div className="space-y-2 pt-0.5">
              <p className="font-semibold text-danger">
                سيؤدي تحديث الصفحة إلى فقدان التعديلات غير المحفوظة. هل تريد المتابعة؟
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="danger" size="sm" onClick={onDiscardAndRefresh}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  أيوه، امسح وحدّث
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  إلغاء
                </Button>
              </div>
            </div>
          ) : (
            <div className="pt-0.5">
              <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
                <RefreshCw className="h-3.5 w-3.5" />
                حدّث الصفحة
              </Button>
            </div>
          )
        ) : null}
      </div>
    )
  }

  // VALIDATION · NOT_FOUND · STORAGE_ERROR · INTERNAL
  return (
    <div className={DANGER} role="alert">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
        الحفظ ما تمّش
      </p>
      <p className="text-muted">{failure.message}</p>
      {onRetry && failure.code !== 'VALIDATION' ? (
        <div className="pt-0.5">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" />
            إعادة المحاولة
          </Button>
        </div>
      ) : null}
    </div>
  )
}
