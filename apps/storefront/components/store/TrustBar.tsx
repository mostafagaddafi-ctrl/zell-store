import { Container } from '../ui/Container'

/**
 * HOME-MOBILE §٥ — شريط الثقة فوق الهيدر على الموبايل بس (sm:hidden)، في كل الصفحات وفي الوضعين (قرار المالك).
 * **Server Component**، صفر JavaScript، وبنفس شكل AnnouncementBar. النص من «سطر الثقة» (content.trustLine)؛
 * القرار (فاضي · الإعلان ظاهر) في lib/home/homeLayout.ts (trustBarText).
 */
export function TrustBar({ text }: { text: string | null }) {
  if (text === null) return null
  return (
    <aside aria-label="الدفع والتوصيل" className="bg-brand text-brand-fg sm:hidden">
      <Container className="flex min-h-8 items-center justify-center py-1 text-center">
        <span className="text-[11.5px] font-semibold leading-5">{text}</span>
      </Container>
    </aside>
  )
}
