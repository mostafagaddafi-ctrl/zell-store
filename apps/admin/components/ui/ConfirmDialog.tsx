'use client'

import { useEffect } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from './Button'

/**
 * كل إجراء هدّام لازم يعدّي من هنا.
 *
 * لما التعديلات موقوفة، السبب بيتكتب **جوه الحوار نفسه** مش في tooltip —
 * زرار معطّل من غير سبب ظاهر بيحيّر اللي بيجرّب.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  onCancel,
  onConfirm,
  disabledReason = 'التعديلات متوقفة حاليًا، ولن يتغيّر أي شيء.',
  notImplementedReason = 'هذا الإجراء غير متاح بعد، ولن يتغيّر أي شيء.',
  busy = false,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm?: () => void
  disabledReason?: string
  notImplementedReason?: string
  /** أثناء بدء/إرسال العملية: التأكيد والإغلاق متعطلين (اختياري — الافتراضي false زي الأول). */
  busy?: boolean
}) {
  const enabled = useMutationsEnabled()

  /**
   * ⚠️ التأكيد بيتعطّل كمان لو onConfirm مش متمرر.
   *
   * من غير الشرط ده، لما العلم يتفتح كان زرار «احذف» الأحمر يبقى
   * **شغّال** وبـ onClick فاضي — يعني إجراء هدّام بيبان متاح
   * وبيعمل لا شيء. ده أسوأ حالة ممكنة في حوار تأكيد.
   */
  const wired = typeof onConfirm === 'function'
  const blocked = !enabled || !wired

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel, busy])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/50 p-4"
      onClick={busy ? undefined : onCancel}
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

        {blocked ? (
          <p className="mt-3 flex items-start gap-2 rounded border-s-2 border-gold bg-bg p-2.5 text-xs font-semibold text-fg">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
            {!enabled ? disabledReason : notImplementedReason}
          </p>
        ) : null}

        <div className="mt-5 flex justify-start gap-2">
          <Button variant="danger" onClick={onConfirm} disabled={blocked || busy}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {enabled ? 'إلغاء' : 'اقفل'}
          </Button>
        </div>
      </div>
    </div>
  )
}
