'use client'

import { useEffect } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { Button } from './Button'

/**
 * كل إجراء هدّام لازم يعدّي من هنا.
 *
 * لما يكون التأكيد معطّل، السبب بيتكتب **جوه الحوار نفسه** مش في tooltip —
 * زرار معطّل من غير سبب ظاهر بيحيّر اللي بيجرّب.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  onCancel,
  onConfirm,
  confirmDisabled = true,
  disabledReason = 'الإجراء ده معطّل في وضع معاينة التصميم.',
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm?: () => void
  confirmDisabled?: boolean
  disabledReason?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-pop"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-fg">{title}</h2>
            <p className="text-xs leading-relaxed text-muted">{message}</p>
          </div>
        </div>

        {confirmDisabled ? (
          <p className="mt-3 flex items-start gap-2 rounded border-s-2 border-gold bg-bg p-2.5 text-xs font-semibold text-fg">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
            {disabledReason}
          </p>
        ) : null}

        <div className="mt-5 flex justify-start gap-2">
          <Button variant="danger" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            {confirmDisabled ? 'اقفل' : 'إلغاء'}
          </Button>
        </div>
      </div>
    </div>
  )
}
