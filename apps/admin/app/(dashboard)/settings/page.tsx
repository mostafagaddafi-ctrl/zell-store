import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { SettingsEditor } from '../../../components/settings/SettingsEditor'
import { SystemHealthView } from '../../../components/settings/SystemHealthView'
import { adminData } from '../../../lib/adminData'
import { requireAdminPage } from '../../../lib/auth/guards'
import { getSystemHealth } from '../../../lib/systemHealth'

export const metadata: Metadata = { title: 'الإعدادات' }
// كل فتحة للصفحة = فحص جديد. مفيش كاش لحالة النظام.
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  await requireAdminPage()

  const [settings, health] = await Promise.all([adminData.getOperationalSettings(), getSystemHealth()])

  return (
    <>
      <PageHeader title="الإعدادات" description="حالة النظام الحقيقية — كل سطر اتفحص دلوقتي" />
      <div className="space-y-4">
        <SystemHealthView health={health} />
        <SettingsEditor settings={settings} />
      </div>
    </>
  )
}
