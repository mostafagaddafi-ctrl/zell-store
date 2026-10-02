import Link from 'next/link'
import { ArrowLeft, Megaphone } from 'lucide-react'
import type { Announcement } from '@zell/core'
import { Container } from '../ui/Container'

/**
 * شريط الإعلان — **Server Component**، صفر JavaScript.
 *
 * ⚠️ مفيش زرار إغلاق في النسخة دي **عن قصد**. الإغلاق محتاج Client
 *    Component يقرا localStorage بعد hydration، وده بيعمل وميض: الشريط
 *    يظهر ثم يختفي. التحكم الحقيقي من اللوحة بـenabled.
 *
 * ⚠️ static مش sticky: الهيدر تحته هو اللي sticky، فالشريط بيتلف مع
 *    التمرير والهيدر يفضل. كده top-0 بتاع الهيدر مابتتكسرش.
 *
 * ⚠️ الرابط مابيفتحش في تاب جديد. لو اتفتح يومًا، rel='noopener
 *    noreferrer' إلزامي.
 */
export function AnnouncementBar({ announcement }: { announcement: Announcement }) {
  if (!announcement.enabled || announcement.text.trim() === '') return null

  const label = announcement.ctaLabel.trim()
  const href = announcement.href.trim()
  const showCta = href !== '' && label !== ''

  const body = (
    <Container className="flex min-h-11 items-center justify-center gap-x-3 py-2 text-center sm:min-h-12 sm:gap-x-4">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-fg/12" aria-hidden="true">
        <Megaphone className="h-3.5 w-3.5" strokeWidth={2.25} />
      </span>
      <span className="line-clamp-2 text-xs font-bold leading-5 sm:text-sm">{announcement.text}</span>
      {showCta ? (
        <span className="flex shrink-0 items-center gap-1 border-r border-brand-fg/25 pr-3 text-xs font-extrabold sm:pr-4 sm:text-sm">
          {label}
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      ) : null}
    </Container>
  )

  // الشريط كله رابط لو فيه href من غير نص زرار — مساحة لمس أكبر على الموبايل
  if (href !== '') {
    return (
      <aside className="border-b border-brand-fg/10 bg-brand text-brand-fg shadow-[inset_0_-1px_0_hsl(var(--brand-fg)/0.08)]">
        <Link href={href} className="block transition-colors hover:bg-brand-fg/5">
          {body}
        </Link>
      </aside>
    )
  }

  return (
    <aside className="border-b border-brand-fg/10 bg-brand text-brand-fg shadow-[inset_0_-1px_0_hsl(var(--brand-fg)/0.08)]">
      {body}
    </aside>
  )
}
