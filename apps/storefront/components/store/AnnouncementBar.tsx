import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { Announcement } from '@zell/core'
import { Container } from '../ui/Container'
import { AnnouncementDismiss } from './AnnouncementDismiss'

/**
 * الشريط العلوي — المحتوى **Server Component** (النص والرابط من «الشريط العلوي» في صفحة المحتوى).
 *
 * رفيع وثابت: بيظهر مع الصفحة من غير حركة ولا تأخير، فمابيزقّش الهيدر. للإعلانات المهمة بس
 * (خصم · مواعيد). ANNOUNCE-CLOSE (2026-11-15): الغلاف AnnouncementDismiss (Client) بيضيف زرار إغلاق
 * بيخفي الشريط للجلسة بس، من غير أي تغيير في الإعلان نفسه.
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
    <AnnouncementDismiss>
      {href !== '' ? (
        <Link href={href} className="block transition-opacity hover:opacity-90">
          {body}
        </Link>
      ) : (
        body
      )}
    </AnnouncementDismiss>
  )
}
