import Link from 'next/link'
import { buttonClasses } from '../ui/Button'

/** النموذج واقف لأن بياناته ناقصة أو مش مؤكدة — رسالة تشغيلية واضحة بدل نموذج من بيانات ناقصة. */
export function EditorBlocked({
  reasons,
  backHref = '/inventory/purchases',
  backLabel = 'رجوع للمشتريات',
}: {
  reasons: string[]
  backHref?: string
  backLabel?: string
}) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-3 text-xs leading-relaxed text-fg">
      <p className="font-semibold">النموذج واقف دلوقتي.</p>
      <ul className="list-disc space-y-1 ps-5 text-muted">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <Link href={backHref} className={buttonClasses('secondary', 'sm')}>
        {backLabel}
      </Link>
    </div>
  )
}
