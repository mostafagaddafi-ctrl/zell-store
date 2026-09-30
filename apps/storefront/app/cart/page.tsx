import type { Metadata } from 'next'
import { CartView } from '../../components/store/CartView'
import { StoreHeader } from '../../components/store/StoreHeader'
import { getStorefrontData } from '../../lib/data/source'

export const metadata: Metadata = { title: 'السلة' }

export default async function CartPage() {
  const { products, settings } = await getStorefrontData()

  return (
    <>
      <StoreHeader storeName={settings.storeName} />
      <main className="mx-auto max-w-app space-y-4 px-4 pb-32 pt-5">
        <h1 className="text-xl font-extrabold text-fg">سلة الطلب</h1>
        <CartView products={products} />
      </main>
    </>
  )
}
