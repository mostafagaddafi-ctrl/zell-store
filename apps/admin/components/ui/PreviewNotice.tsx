import { Lock } from 'lucide-react'

/**
 * بانر ثابت فوق كل صفحة فيها تعديل.
 *
 * ⚠️ النص اتغيّر في مرحلة ربط الواجهة.
 * قبل كده كان بيقول «لسه مش متوصل بقاعدة البيانات» — وده بقى **غلط**:
 * الأزرار متوصلة بالكامل بأفعال السيرفر، واللي بيوقف الكتابة هو علم
 * الجاهزية. بانر بيقول حاجة مش صح أسوأ من مفيش بانر.
 */
export function PreviewNotice({ what, note }: { what: string; note?: string }) {
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
