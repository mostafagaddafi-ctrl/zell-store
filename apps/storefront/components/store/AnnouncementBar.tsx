import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { Announcement } from '@zell/core'
import { Container } from '../ui/Container'

/**
 * الشريط العلوي — **Server Component**، صفر JavaScript.
 *
 * رفيع وثابت: بيظهر مع الصفحة من غير حركة ولا تأخير ولا زرار إغلاق،
 * فمابيزقّش الهيدر ومابيختفيش بعد الريفرش. للإعلانات المهمة بس
 * (خصم · مواعيد)، والتحكم من «الشريط العلوي» في صفحة المحتوى.
 *
 * «نص العرض» (الهدية) **مش هنا** — مكانه صفحة المنتج وملخص الطلب
 * (GiftNote · OrderSummary)، في لحظة قرار الشراء.
 *
 * static مش sticky: الهيدر تحته هو اللي sticky.
 * الرابط مابيفتحش في تاب جديد. لو اتفتح يومًا، rel='noopener noreferrer' إلزامي.
 */
export function AnnouncementBar({ announcement }: { announcement: Announcement }) {
  const text = announcement.text.trim()
  if (!announcement.enabled || text === '') return null

  const href = announcement.href.trim()
  const label = announcement.ctaLabel.trim()

  const body = (
    <Container className="flex min-h-9 items-center justify-center gap-2 py-1.5 text-center">
      <span className="line-clamp-2 text-xs font-medium leading-5 sm:text-[13px]">{text}</span>
      {href !== '' && label !== '' ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold underline decoration-brand-fg/40 underline-offset-4">
          {label}
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
        </span>
      ) : null}
    </Container>
  )

  return (
    <aside aria-label="إعلان" className="bg-brand text-brand-fg">
      {href !== '' ? (
        <Link href={href} className="block transition-opacity hover:opacity-90">
          {body}
        </Link>
      ) : (
        body
      )}
    </aside>
  )
}
