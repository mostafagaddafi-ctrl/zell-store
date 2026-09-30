'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

/** كل إجراء هدّام لازم يعدّي من هنا. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  onCancel,
  onConfirm,
  confirmDisabled = true,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm?: () => void
  confirmDisabled?: boolean
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

        <div className="mt-5 flex justify-start gap-2">
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={confirmDisabled}
            title={confirmDisabled ? 'معطّل في مرحلة المعاينة' : undefined}
          >
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
        </div>
      </div>
    </div>
  )
}
