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
 *
 * الزرار بيتعطّل لسببين مختلفين، وكل سبب له نص مختلف:
 *
 *   ١. علم الجاهزية مقفول        -> «التعديلات موقوفة»
 *   ٢. onSave مش متمرر           -> «الحفظ لسه ما اتعملش»
 *
 * ⚠️ الشرط التاني مهم. من غيره، أي شاشة لسه ما اتوصلتش كانت بتعرض
 * زرار حفظ **شغّال** بـ onClick فاضي بعد ما العلم يتفتح: المستخدم
 * يضغط، مايحصلش حاجة، ولا رسالة نجاح ولا فشل. الصمت ده أخطر من
 * زرار معطّل بسبب مكتوب.
 */
export function SaveBar({ state, onSave, warning }: { state: SaveState; onSave?: () => void; warning?: string | null }) {
  const enabled = useMutationsEnabled()
  const label = LABELS[state]

  const wired = typeof onSave === 'function'
  const blocked = !enabled || !wired
  const reason = !enabled ? 'التعديلات موقوفة' : !wired ? 'الحفظ لسه ما اتعملش' : null

  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6">
      <div className="min-w-0">
      <p className={'flex items-center gap-1.5 text-xs font-medium ' + label.tone}>
        {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {state === 'saved' ? <Check className="h-3.5 w-3.5" /> : null}
        {state === 'conflict' || state === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
        {label.text}
      </p>
      {warning ? <p className="mt-1 max-w-xl text-xs text-gold">{warning}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {reason ? <span className="text-xs text-muted">{reason}</span> : null}
        <Button disabled={blocked} onClick={onSave}>
          {blocked ? <Lock className="h-3.5 w-3.5" /> : null}
          حفظ
        </Button>
      </div>
    </div>
  )
}
