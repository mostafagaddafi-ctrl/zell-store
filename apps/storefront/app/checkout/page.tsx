import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/store/CheckoutForm'
import { BackButton } from '../../components/ui/BackButton'
import { Container } from '../../components/ui/Container'
import { getStorefrontData } from '../../lib/data/source'

export const metadata: Metadata = { title: 'بيانات التوصيل' }

export default async function CheckoutPage() {
  const { products, settings } = await getStorefrontData()

  return (
    <Container className="py-8 md:py-12">
      {/* رجوع بسجل المتصفح (البيانات في السلة مابتتمسحش)، وإلا للسلة */}
      <BackButton fallback="/cart" />

      <h1 className="mt-4 text-xl font-extrabold text-fg md:text-2xl">بيانات التوصيل</h1>

      <div className="mt-6">
        <CheckoutForm products={products} settings={settings} />
      </div>
    </Container>
  )
}
