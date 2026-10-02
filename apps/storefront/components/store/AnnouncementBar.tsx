import Link from 'next/link'
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
    <Container className="flex min-h-9 items-center justify-center gap-x-2.5 py-1.5 text-center sm:min-h-10 sm:gap-x-3 sm:py-2">
      <span className="line-clamp-2 text-[11px] font-semibold leading-5 sm:text-sm">{announcement.text}</span>
      {showCta ? (
        <span className="shrink-0 border-b border-brand-fg/70 text-[11px] font-bold sm:text-sm">{label}</span>
      ) : null}
    </Container>
  )

  // الشريط كله رابط لو فيه href من غير نص زرار — مساحة لمس أكبر على الموبايل
  if (href !== '') {
    return (
      <aside className="bg-brand text-brand-fg">
        <Link href={href} className="block transition-opacity hover:opacity-90">
          {body}
        </Link>
      </aside>
    )
  }

  return <aside className="bg-brand text-brand-fg">{body}</aside>
}
