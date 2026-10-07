'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { REASON_LIMITS, normalizeReason } from '../../lib/inventory/purchaseForm'
import { Button } from '../ui/Button'
import { textareaClasses } from '../ui/Field'

/**
 * حوار سبب الاستبعاد/الإبطال. السبب بيتحقق هنا بنفس normalizeReason اللي السيرفر بيعيده:
 *   • الاستبعاد: إجباري 1–300 (أشد من الداتابيز).
 *   • الإبطال: 3–300 (زي الداتابيز).
 * الحوار مابيبعتش حاجة بنفسه — بيرجّع السبب للمستدعي اللي بيبدأ النية.
 *
 * 🔒 busy بيعطّل التأكيد والرجوع وEscape والضغط برّه أثناء بدء/إرسال العملية، و firedRef بيمنع
 *    تأكيد تاني في نفس الـtick لحد ما الحوار يتقفل ويتفتح من جديد (والقفل المشترك هو الحماية الأساسية).
 */
export function ReasonDialog({
  open,
  kind,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
}: {
  open: boolean
  kind: 'discard' | 'void'
  title: string
  message: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: (reason: string) => void
  busy?: boolean
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  // ref عشان callback جديد من الأب في كل render مايمسحش السبب اللي اتكتب
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const busyRef = useRef(busy)
  busyRef.current = busy
  const firedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setText('')
    setError(null)
    firedRef.current = false
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onCancelRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const limits = REASON_LIMITS[kind]

  function confirm() {
    if (busy || firedRef.current) return
    const reason = normalizeReason(text, kind)
    if (!reason.ok) {
      setError(reason.message)
      return
    }
    firedRef.current = true
    onConfirm(reason.value)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/50 p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-pop"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-fg">{title}</h2>
            <p className="text-xs leading-relaxed text-muted">{message}</p>
          </div>
        </div>

        <label htmlFor="inventory-reason" className="mt-4 block text-xs font-semibold text-fg">
          السبب (من {limits.min} لـ {limits.max} حرف)
        </label>
        <textarea
          id="inventory-reason"
          value={text}
          maxLength={limits.max + 50}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
          className={textareaClasses + ' mt-1'}
        />
        {error ? <p className="mt-1 text-xs font-medium text-danger">{error}</p> : null}

        <div className="mt-5 flex justify-start gap-2">
          <Button variant="danger" onClick={confirm} disabled={busy}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            رجوع
          </Button>
        </div>
      </div>
    </div>
  )
}
