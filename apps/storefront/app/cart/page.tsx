import type { Metadata } from 'next'
import { CartView } from '../../components/store/CartView'
import { Container } from '../../components/ui/Container'
import { getStorefrontData } from '../../lib/data/source'

export const metadata: Metadata = { title: 'السلة' }

export default async function CartPage() {
  const { products, settings } = await getStorefrontData()

  return (
    <Container className="py-8 md:py-12">
      <h1 className="text-xl font-extrabold text-fg md:text-2xl">سلة الطلب</h1>
      <div className="mt-6">
        <CartView products={products} trustLine={settings.content.trustLine} />
      </div>
    </Container>
  )
}
