import type { Metadata } from 'next'
import { TrackOrderForm } from '../../components/store/TrackOrderForm'
import { Container } from '../../components/ui/Container'

/**
 * TRACK-ORDER W2 — صفحة «تتبّع طلبك» (العقد docs/contracts/TRACK-ORDER.md §٤).
 *
 *   • من غير تسجيل دخول ولا تحقق بالهاتف: رقم الطلب هو المفتاح (قرار المالك)، ومن غير حد للمحاولات.
 *   • النداء من السيرفر (app/track/actions.ts)، والكود مابيدخلش الرابط.
 *   • noindex, nofollow (النتيجة شخصية)، والصفحة مش في الـ sitemap.
 */
export const metadata: Metadata = {
  title: 'تتبّع طلبك',
  robots: { index: false, follow: false },
}

export default function TrackOrderPage() {
  return (
    <Container size="narrow" className="py-10 sm:py-14">
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-fg">تتبّع طلبك</h1>
          <p className="text-sm leading-relaxed text-muted">اكتب رقم الطلب علشان تشوف حالته وتفاصيله.</p>
        </div>
        <TrackOrderForm />
      </div>
    </Container>
  )
}
