import type { Metadata } from 'next'
import { orderGovernorates } from '@zell/core'
import { PageHeader } from '../../../components/shell/PageHeader'
import { ShippingEditor } from '../../../components/shipping/ShippingEditor'
import { ShippingOptionsCard } from '../../../components/shipping/ShippingOptionsCard'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { pageWithAccess } from '../../../lib/access/instance'
import { readShippingOrder } from '../../../lib/data/shippingOrder'
import { readShippingAreas } from '../../../lib/data/shippingAreas'
import { readInstallationRecord } from '../../../lib/data/installation'
import { getShippingOptions } from '../../../lib/data/shippingOptions'

export const metadata: Metadata = { title: 'الشحن' }

export default pageWithAccess('zell.shipping.view', async function ShippingPage(ctx) {
  const [shipping, order, areas, installation, shippingOptions] = await Promise.all([
    adminData.getShipping(),
    readShippingOrder(),
    readShippingAreas(),
    readInstallationRecord(),
    // EXPRESS-SHIPPING W2 — إعداد مدة الشحن والشحن السريع (null = الكارت بيعرض «غير متاح حاليًا»)
    getShippingOptions(),
  ])
  // مناطق متاحة لفني التركيب — للتحذير قبل مسحها أو تغيير اسمها
  const installerAreas = Object.fromEntries(
    Object.entries(installation.config.areas).map(([governorate, list]) => [governorate, Object.keys(list)]),
  )
  // المحافظات المتاحة في الشحن العادي (في الأسعار ومش موقوفة) بنفس ترتيبه — صفوف كارت الشحن السريع
  const served = orderGovernorates(Object.keys(shipping.rates), order).filter((name) => !shipping.disabled.includes(name))

  return (
    <>
      <PageHeader title="الشحن" description="المحافظات (إضافة · مسح · سعر · ترتيب) ومناطق كل محافظة والحد المجاني" />
      <div className="mb-4">
        <PreviewNotice what="تعديل أسعار الشحن والمحافظات والمناطق" />
      </div>
      <ShippingEditor shipping={shipping} order={order} areas={areas} installerAreas={installerAreas} />
      <div className="mt-6">
        <ShippingOptionsCard
          key={shippingOptions?.updatedAt ?? 'none'}
          settings={shippingOptions}
          served={served}
          canSave={ctx.identity.role === 'owner'}
        />
      </div>
    </>
  )
})
