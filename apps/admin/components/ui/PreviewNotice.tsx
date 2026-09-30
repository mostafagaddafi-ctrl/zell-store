import { Lock } from 'lucide-react'

/**
 * بانر ثابت في كل صفحة فيها تعديل.
 * المرحلة أ: **مفيش أي كتابة على الإطلاق** — لا حقيقية ولا محاكاة،
 * عشان محدش يفتكر إنه حفظ وهو ما حفظش.
 */
export function PreviewNotice({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border-s-2 border-gold bg-surface px-3 py-2.5">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
      <p className="text-xs leading-relaxed text-muted">
        <span className="font-semibold text-fg">معاينة تصميم.</span> {what} لسه مش متوصل بقاعدة البيانات، وكل أزرار
        الحفظ معطّلة. مفيش أي تعديل بيتسجّل.
      </p>
    </div>
  )
}
