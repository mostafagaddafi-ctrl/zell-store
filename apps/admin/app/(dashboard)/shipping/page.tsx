import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { ShippingEditor } from '../../../components/shipping/ShippingEditor'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { requireAdminPage } from '../../../lib/auth/guards'
import { readShippingOrder } from '../../../lib/mutations/shippingOrder'

export const metadata: Metadata = { title: 'الشحن' }

export default async function ShippingPage() {
  await requireAdminPage()

  const [shipping, order] = await Promise.all([adminData.getShipping(), readShippingOrder()])

  return (
    <>
      <PageHeader title="الشحن" description="أسعار المحافظات وترتيبها في صفحة الطلب والحد المجاني" />
      <div className="mb-4">
        <PreviewNotice what="تعديل أسعار الشحن وتفعيل المحافظات" />
      </div>
      <ShippingEditor shipping={shipping} order={order} />
    </>
  )
}
