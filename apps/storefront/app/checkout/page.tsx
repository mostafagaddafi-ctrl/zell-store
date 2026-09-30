import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/store/CheckoutForm'
import { StoreHeader } from '../../components/store/StoreHeader'
import { getStorefrontData } from '../../lib/data/source'

export const metadata: Metadata = { title: 'بيانات التوصيل' }

export default async function CheckoutPage() {
  const { products, settings } = await getStorefrontData()

  return (
    <>
      <StoreHeader storeName={settings.storeName} />
      <main className="mx-auto max-w-app space-y-4 px-4 pb-56 pt-5">
        <h1 className="text-xl font-extrabold text-fg">بيانات التوصيل</h1>
        {/* إرسال الطلب لسه معطّل — CheckoutForm ما اتغيّرش */}
        <CheckoutForm products={products} settings={settings} />
      </main>
    </>
  )
}
