import { Loader2 } from 'lucide-react'
import { Container } from '../../components/ui/Container'

/**
 * BUY-NOW — شاشة التحميل لصفحة بيانات الطلب: بتظهر فورًا وقت ما السيرفر بيجهّز البيانات (الشحن · الفترات · رسوم التأكيد).
 */
export default function CheckoutLoading() {
  return (
    <Container className="py-8 md:py-12">
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Loader2 className="h-5 w-5 animate-spin text-brand motion-reduce:animate-none" aria-hidden="true" />
        جارٍ تحميل بيانات الطلب…
      </div>
      <div aria-hidden="true" className="mt-6 space-y-3">
        <div className="h-7 w-48 animate-pulse rounded bg-border motion-reduce:animate-none" />
        <div className="h-24 animate-pulse rounded-lg bg-border motion-reduce:animate-none" />
        <div className="h-12 animate-pulse rounded-lg bg-border motion-reduce:animate-none" />
        <div className="h-12 animate-pulse rounded-lg bg-border motion-reduce:animate-none" />
      </div>
    </Container>
  )
}
