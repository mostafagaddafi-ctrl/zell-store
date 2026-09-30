import type { Metadata } from 'next'
import { PageHeader } from '../../components/shell/PageHeader'
import { ShippingEditor } from '../../components/shipping/ShippingEditor'
import { PreviewNotice } from '../../components/ui/PreviewNotice'
import { adminData } from '../../lib/adminData'

export const metadata: Metadata = { title: 'الشحن' }

export default async function ShippingPage() {
  const shipping = await adminData.getShipping()

  return (
    <>
      <PageHeader title="الشحن" description="أسعار المحافظات والحد المجاني" />
      <div className="mb-4">
        <PreviewNotice what="تعديل أسعار الشحن وتفعيل المحافظات" />
      </div>
      <ShippingEditor shipping={shipping} />
    </>
  )
}
