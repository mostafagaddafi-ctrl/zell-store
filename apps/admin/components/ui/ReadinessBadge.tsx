'use client'

import { Check, Lock } from 'lucide-react'
import { useMutationsEnabled } from '../../lib/readiness'

/**
 * حالة علم الجاهزية — من ReadinessProvider، مش من أي قيمة ثابتة.
 *
 * الغرض: الأدمن يعرف بنظرة إن الكتابة مفتوحة ولا مقفولة، من غير ما
 * يحاول يحفظ عشان يكتشف.
 */
export function ReadinessBadge() {
  const enabled = useMutationsEnabled()

  if (enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-ok/40 bg-ok/10 px-2 py-1 text-xs font-semibold text-ok">
        <Check className="h-3.5 w-3.5" />
        التعديلات مفعّلة
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-gold/40 bg-gold/10 px-2 py-1 text-xs font-semibold text-fg">
      <Lock className="h-3.5 w-3.5" />
      التعديلات موقوفة
    </span>
  )
}
