'use client'

import { usePathname } from 'next/navigation'
import { MessageCircle } from 'lucide-react'

/**
 * زرار واتساب عائم — **تحت شمال** على الموبايل والكمبيوتر.
 *
 *   كل المقاسات: كبسولة بالأيقونة + النص «استفسر على واتساب» (WHATSAPP-PILL، قرار المالك 2026-11-15:
 *   الدايرة على الموبايل كانت صغيرة وممكن محدش ياخد باله منها). المكان زي ما هو، وممنوع يتلمس.
 *
 * ⚠️ left/bottom مكتوبين inline جوه calc مع env(safe-area-inset-*) —
 *    عشان حافة iPhone السفلية والـnotch في الوضع العرضي. Tailwind
 *    مابيولّدش كلاسات لقيم env() بتتحسب وقت التشغيل.
 *
 * ⚠️ مخفي في /checkout بس: زرار «إرسال الطلب» جوه الفورم، والزرار العائم
 *    ممكن يعدّي فوقه وقت الـscroll. واتساب لسه موجود هناك في الهيدر
 *    (الكمبيوتر) وجزء «المساعدة» في قائمة الموبايل. في /cart والمنتج والإيصال ظاهر.
 *
 * ⚠️ مفيش رفع فوق شريط سلة: CartBar مش متركّب في أي صفحة. حشو الفوتر
 *    السفلي (SiteFooter) هو اللي بيمنع الزرار يغطي آخر الصفحة.
 */
export function WhatsAppFab({ number, message }: { number: string; message: string }) {
  const pathname = usePathname() ?? ''
  if (!number) return null
  if (pathname === '/checkout' || pathname.startsWith('/checkout/')) return null

  const href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(message)

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="استفسر على واتساب"
      title="استفسر على واتساب"
      style={{
        left: 'calc(env(safe-area-inset-left) + 1rem)',
        bottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
      }}
      className="fixed z-30 flex h-12 items-center justify-center gap-2 rounded-full border border-whatsapp-fg/20 bg-whatsapp px-4 text-sm font-bold text-whatsapp-fg shadow-lg transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">استفسر على واتساب</span>
    </a>
  )
}
