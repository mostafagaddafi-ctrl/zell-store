import type { Metadata } from 'next'
import { CheckoutForm } from '../../components/store/CheckoutForm'
import { BackButton } from '../../components/ui/BackButton'
import { Container } from '../../components/ui/Container'
import {
  getCheckoutConfirmationFee,
  getCheckoutDeliverySettings,
  getCheckoutPeriods,
  getCheckoutShippingOptions,
  getStorefrontData,
} from '../../lib/data/source'

export const metadata: Metadata = { title: 'بيانات التوصيل' }

export default async function CheckoutPage() {
  const { products, settings } = await getStorefrontData()
  // 0021-D — أوقات الفترات من الداتابيز (null = الأسماء بس)
  const periods = await getCheckoutPeriods()
  // 0021-A P2 — إعداد رسوم التأكيد (null = مفيش سطر مقدم)
  const confirmationFee = await getCheckoutConfirmationFee()
  // 0021-D2 — إعداد موعد التسليم (null = اختيار الموعد والسطر مخفيين)
  const deliverySettings = await getCheckoutDeliverySettings()
  // EXPRESS-SHIPPING — إعداد الشحن السريع ومدة الشحن (null = اختيار الطريقة مخفي والطلب عادي)
  const shippingOptions = await getCheckoutShippingOptions()

  return (
    <Container className="py-8 md:py-12">
      {/* رجوع بسجل المتصفح (البيانات في السلة مابتتمسحش)، وإلا للسلة */}
      <BackButton fallback="/cart" />

      <h1 className="mt-4 text-xl font-extrabold text-fg md:text-2xl">بيانات التوصيل</h1>

      <div className="mt-6">
        <CheckoutForm
          products={products}
          settings={settings}
          periods={periods}
          confirmationFee={confirmationFee}
          deliverySettings={deliverySettings}
          shippingOptions={shippingOptions}
        />
      </div>
    </Container>
  )
}
