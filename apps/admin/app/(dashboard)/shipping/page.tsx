import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { ShippingEditor } from '../../../components/shipping/ShippingEditor'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { pageWithAccess } from '../../../lib/access/instance'
import { readShippingOrder } from '../../../lib/data/shippingOrder'
import { readShippingAreas } from '../../../lib/data/shippingAreas'
import { readInstallationRecord } from '../../../lib/data/installation'

export const metadata: Metadata = { title: 'الشحن' }

export default pageWithAccess('zell.shipping.view', async function ShippingPage(_ctx) {
  const [shipping, order, areas, installation] = await Promise.all([
    adminData.getShipping(),
    readShippingOrder(),
    readShippingAreas(),
    readInstallationRecord(),
  ])
  // مناطق متاحة لفني التركيب — للتحذير قبل مسحها أو تغيير اسمها
  const installerAreas = Object.fromEntries(
    Object.entries(installation.config.areas).map(([governorate, list]) => [governorate, Object.keys(list)]),
  )

  return (
    <>
      <PageHeader title="الشحن" description="المحافظات (إضافة · مسح · سعر · ترتيب) ومناطق كل محافظة والحد المجاني" />
      <div className="mb-4">
        <PreviewNotice what="تعديل أسعار الشحن والمحافظات والمناطق" />
      </div>
      <ShippingEditor shipping={shipping} order={order} areas={areas} installerAreas={installerAreas} />
    </>
  )
})
