'use client'

import { MessageCircle } from 'lucide-react'
import { useCart } from '../../lib/cart'

/**
 * زرار واتساب عائم — **موبايل بس**.
 *
 * على الديسكتوب مخفي (md:hidden) لأن التواصل موجود في الهيدر بنصّه،
 * فزرار عائم كمان بيبقى تكرار بصري.
 *
 * ⚠️ **مايغطّيش CartBar.** الاتنين fixed تحت. CartBar بيظهر بس لما
 *    يكون في حاجة في السلة، فالارتفاع بيتحسب من نفس الشرط:
 *      سلة فاضية  -> فوق الحد السفلي بمسافة صغيرة
 *      سلة فيها حاجة -> فوق CartBar بالكامل (ارتفاعه h-14 + حشوه)
 *    ولو حسبناها بـCSS بس، كنا هنحتاج نخمّن ظهور CartBar — والتخمين
 *    ده هو اللي بيخلّي الزرار يقعد فوق زرار «إتمام الطلب».
 *
 * ⚠️ env(safe-area-inset-bottom) جوه calc — عشان شرائح iPhone السفلية.
 *    مكتوب كـinline style مش كـarbitrary class: القيمة بتتغير بالحالة،
 *    وTailwind مابيولّدش كلاسات لقيم بتتحسب في وقت التشغيل.
 *
 * ⚠️ الحشو السفلي للمحتوى في layout هو اللي بيمنع الزرار من تغطية
 *    آخر عنصر في الصفحة. الزرار لوحده مش كفاية.
 */
export function WhatsAppFab({ number, message }: { number: string; message: string }) {
  const cart = useCart()
  if (!number) return null

  const href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(message)
  const aboveCartBar = cart.ready && cart.count > 0

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="استفسر على واتساب"
      style={{
        bottom: aboveCartBar
          ? 'calc(env(safe-area-inset-bottom) + 6rem)'
          : 'calc(env(safe-area-inset-bottom) + 1rem)',
      }}
      className="fixed start-4 z-30 flex h-12 items-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-bold text-white shadow-card transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
    >
      <MessageCircle className="h-5 w-5 shrink-0" />
      استفسر على واتساب
    </a>
  )
}
