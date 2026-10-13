import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { DeliverySettingsCard } from '../../../components/settings/DeliverySettingsCard'
import { SettingsEditor } from '../../../components/settings/SettingsEditor'
import { SystemHealthView } from '../../../components/settings/SystemHealthView'
import { adminData } from '../../../lib/adminData'
import { pageWithAccess } from '../../../lib/access/instance'
import { getDeliverySettings } from '../../../lib/data/deliverySettings'
import { getSystemHealth } from '../../../lib/systemHealth'

export const metadata: Metadata = { title: 'الإعدادات' }
// كل فتحة للصفحة = فحص جديد. مفيش كاش لحالة النظام.
export const dynamic = 'force-dynamic'

export default pageWithAccess('zell.settings.view', async function SettingsPage(ctx) {
  // 0021-D2 — إعداد موعد التسليم: القراية لأي أدمن شغّال، والحفظ للمالك بس (والقرار النهائي في الداتابيز)
  const [settings, health, delivery] = await Promise.all([adminData.getOperationalSettings(), getSystemHealth(), getDeliverySettings()])

  return (
    <>
      <PageHeader title="الإعدادات" description="حالة النظام الفعلية — تم فحص كل بند الآن" />
      <div className="space-y-4">
        <SystemHealthView health={health} />
        <DeliverySettingsCard key={delivery?.updatedAt ?? 'none'} settings={delivery} canSave={ctx.identity.role === 'owner'} />
        <SettingsEditor settings={settings} />
      </div>
    </>
  )
})
