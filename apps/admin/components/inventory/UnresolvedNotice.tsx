'use client'

import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { LEAVE_WARNING } from '../../lib/inventory/intent'
import { INTENT_LABELS } from '../../lib/inventory/labels'
import { Button } from '../ui/Button'

/**
 * بانر النتيجة غير المحسومة (lib/inventory/intent.ts).
 *
 *   • عادي (soft): «إعادة نفس المحاولة» بنفس المفتاح ونفس البيانات المتجمّدة،
 *     أو «ترك المحاولة ومراجعة الحالة».
 *   • hard (45212): مفيش إعادة — المسار الوحيد التحديث ومراجعة الحالة.
 *
 * «ترك المحاولة» مابيلغيش أي حاجة في الداتابيز: بيقفل النموذج ويقرا الحالة من جديد.
 */
export function UnresolvedNotice({
  message,
  hard,
  attempt,
  onRetry,
  onAbandon,
}: {
  message: string
  hard: boolean
  attempt: number
  onRetry: () => void
  onAbandon: () => void
}) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs leading-relaxed text-fg"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
        {hard ? 'تعارض في مفتاح العملية' : 'النتيجة مش واضحة'}
      </p>
      <p className="text-muted">{message}</p>
      {hard ? null : (
        <>
          <p className="text-muted">{LEAVE_WARNING}</p>
          <p className="text-muted">
            الحقول مقفولة عشان المحاولة تتعاد بنفس البيانات بالظبط. المحاولة رقم {attempt}.
          </p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {hard ? null : (
          <Button size="sm" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" />
            {INTENT_LABELS.retry}
          </Button>
        )}
        <Button variant={hard ? 'primary' : 'secondary'} size="sm" onClick={onAbandon}>
          <RefreshCw className="h-3.5 w-3.5" />
          {hard ? INTENT_LABELS.reconcile : INTENT_LABELS.abandon}
        </Button>
      </div>
      <p className="text-muted">
        ترك المحاولة مابيرجّعش أي حاجة اتنفذت: بيقفل النموذج ويقرا الحالة من جديد، فراجع القايمة قبل ما تبدأ تاني.
      </p>
    </div>
  )
}
