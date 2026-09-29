import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/store/CheckoutForm'
import { StoreHeader } from '../../components/store/StoreHeader'
import { getFallbackProducts, getFallbackSettings } from '../../lib/catalog'

export const metadata: Metadata = { title: 'بيانات التوصيل' }

export default function CheckoutPage() {
  const settings = getFallbackSettings()

  return (
    <>
      <StoreHeader storeName={settings.storeName} />
      <main className="mx-auto max-w-app space-y-4 px-4 pb-56 pt-5">
        <h1 className="text-xl font-extrabold text-fg">بيانات التوصيل</h1>
        <CheckoutForm products={getFallbackProducts()} settings={settings} />
      </main>
    </>
  )
}
