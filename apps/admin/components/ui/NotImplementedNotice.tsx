import { Hammer } from 'lucide-react'

/**
 * إشعار إن الميزة نفسها **لسه ما اتعملتش**.
 *
 * ⚠️ مستقل تمامًا عن علم الجاهزية، وده مقصود.
 *
 * PreviewNotice بيختفي لما العلم يتفتح، وده صح لأنه بيتكلم عن العلم.
 * لكن فيه شاشات الكتابة فيها ما اتعملتش أصلًا — لو اختفى كل إشعار
 * لما العلم يتفتح، الشاشات دي هتبان شغّالة وهي مش شغّالة.
 *
 * القاعدة: العلم بيتكلم عن **الإذن**، والإشعار ده بيتكلم عن **الوجود**.
 */
export function NotImplementedNotice({ what, note }: { what: string; note?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border-s-2 border-accent bg-surface px-3 py-2.5">
      <Hammer className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <p className="text-xs leading-relaxed text-muted">
        <span className="font-semibold text-fg">لسه ما اتعملش.</span> {what}
        {note ? <span className="mt-1 block font-semibold text-fg">{note}</span> : null}
      </p>
    </div>
  )
}
