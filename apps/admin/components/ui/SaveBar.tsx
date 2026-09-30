'use client'

import { AlertTriangle, Check, Loader2, Lock } from 'lucide-react'
import type { SaveState } from '../../lib/adminData'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from './Button'

const LABELS: Record<SaveState, { text: string; tone: string }> = {
  idle: { text: 'مفيش تغييرات', tone: 'text-muted' },
  dirty: { text: 'فيه تغييرات مش محفوظة', tone: 'text-gold' },
  saving: { text: 'بيحفظ…', tone: 'text-muted' },
  saved: { text: 'اتحفظ', tone: 'text-ok' },
  conflict: { text: 'حد تاني عدّل نفس السجل — حدّث الصفحة', tone: 'text-danger' },
  error: { text: 'الحفظ فشل', tone: 'text-danger' },
}

/**
 * شريط الحفظ — حالة واحدة صريحة دايمًا ظاهرة.
 * الزرار بيتفعّل من علم الجاهزية، مش من قيمة ثابتة في الكود.
 */
export function SaveBar({ state, onSave }: { state: SaveState; onSave?: () => void }) {
  const enabled = useMutationsEnabled()
  const label = LABELS[state]

  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <p className={'flex items-center gap-1.5 text-xs font-medium ' + label.tone}>
        {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {state === 'saved' ? <Check className="h-3.5 w-3.5" /> : null}
        {state === 'conflict' || state === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
        {label.text}
      </p>

      <div className="flex items-center gap-2">
        {!enabled ? <span className="text-xs text-muted">التعديلات موقوفة</span> : null}
        <Button disabled={!enabled} onClick={onSave}>
          {!enabled ? <Lock className="h-3.5 w-3.5" /> : null}
          حفظ
        </Button>
      </div>
    </div>
  )
}
