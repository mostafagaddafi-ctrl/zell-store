'use client'

import { Lock } from 'lucide-react'
import { useMutationsEnabled } from '../../lib/readiness'

/**
 * تحذير إن التعديلات موقوفة.
 *
 * ⚠️ بيقرا العلم من ReadinessProvider — **مش** نص ثابت.
 *
 * قبل كده كان بيعرض التحذير دايمًا، فلما العلم اتفتح فضل يقول إن
 * الكتابة موقوفة وهي شغّالة. بانر بيكدب أسوأ من مفيش بانر: اللي
 * بيقراه بيفقد الثقة في كل بانر تاني في اللوحة.
 *
 * لما التعديلات مفعّلة مابيعرضش حاجة. الحالة الإيجابية مكانها
 * ReadinessBadge في صفحة الإعدادات — مش بانر فوق كل صفحة، عشان
 * البانرات تفضل معناها «في حاجة محتاجة انتباهك».
 */
export function PreviewNotice({ what, note }: { what: string; note?: string }) {
  const enabled = useMutationsEnabled()
  if (enabled) return null

  return (
    <div className="flex items-start gap-2 rounded-lg border-s-2 border-gold bg-surface px-3 py-2.5">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
      <p className="text-xs leading-relaxed text-muted">
        <span className="font-semibold text-fg">التعديلات موقوفة.</span> {what} متوصّل بقاعدة البيانات، بس علم
        الجاهزية لسه مقفول — فأزرار الحفظ معطّلة ومفيش أي تعديل بيتسجّل.
        {note ? <span className="mt-1 block font-semibold text-fg">{note}</span> : null}
      </p>
    </div>
  )
}
