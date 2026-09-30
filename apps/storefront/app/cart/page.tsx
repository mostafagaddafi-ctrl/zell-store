import type { Metadata } from 'next'
import { CartView } from '../../components/store/CartView'
import { Container } from '../../components/ui/Container'
import { getStorefrontData } from '../../lib/data/source'

export const metadata: Metadata = { title: 'السلة' }

export default async function CartPage() {
  const { products } = await getStorefrontData()

  return (
    <Container size="narrow" className="space-y-4 pb-32 pt-8">
      <h1 className="text-xl font-extrabold text-fg">سلة الطلب</h1>
      <CartView products={products} />
    </Container>
  )
}
