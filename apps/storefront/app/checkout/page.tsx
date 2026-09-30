import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/store/CheckoutForm'
import { Container } from '../../components/ui/Container'
import { getStorefrontData } from '../../lib/data/source'

export const metadata: Metadata = { title: 'بيانات التوصيل' }

export default async function CheckoutPage() {
  const { products, settings } = await getStorefrontData()

  return (
    <Container size="narrow" className="space-y-4 pb-56 pt-8">
      <h1 className="text-xl font-extrabold text-fg">بيانات التوصيل</h1>
      {/* إرسال الطلب لسه معطّل — CheckoutForm ما اتغيّرش */}
      <CheckoutForm products={products} settings={settings} />
    </Container>
  )
}
