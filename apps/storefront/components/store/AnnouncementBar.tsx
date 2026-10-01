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
    <Container className="flex min-h-10 flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-center">
      <span className="text-xs font-medium leading-relaxed sm:text-sm">{announcement.text}</span>
      {showCta ? (
        <span className="text-xs font-bold underline underline-offset-4 sm:text-sm">{label}</span>
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
