'use client'

import { usePathname } from 'next/navigation'
import { MessageCircle } from 'lucide-react'

/**
 * زرار واتساب عائم — **تحت شمال** على الموبايل والكمبيوتر.
 *
 *   الموبايل:  دايرة ٥٢px بالأيقونة (اسمها للوصول «استفسر على واتساب»)
 *   الكمبيوتر: الأيقونة + النص
 *
 * ⚠️ left/bottom مكتوبين inline جوه calc مع env(safe-area-inset-*) —
 *    عشان حافة iPhone السفلية والـnotch في الوضع العرضي. Tailwind
 *    مابيولّدش كلاسات لقيم env() بتتحسب وقت التشغيل.
 *
 * ⚠️ مخفي في /checkout بس: زرار «إرسال الطلب» جوه الفورم، والزرار العائم
 *    ممكن يعدّي فوقه وقت الـscroll. واتساب لسه موجود هناك في الهيدر
 *    (الكمبيوتر) وآخر قائمة الموبايل. في /cart والمنتج والإيصال ظاهر.
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
      className="fixed z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-whatsapp-fg/20 bg-whatsapp text-whatsapp-fg shadow-lg transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:h-12 md:w-auto md:gap-2 md:px-4 md:text-sm md:font-bold"
    >
      <MessageCircle className="h-6 w-6 shrink-0 md:h-5 md:w-5" aria-hidden="true" />
      <span className="hidden md:inline">استفسر على واتساب</span>
    </a>
  )
}
