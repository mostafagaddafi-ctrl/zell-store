import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { SettingsEditor } from '../../../components/settings/SettingsEditor'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { ReadinessBadge } from '../../../components/ui/ReadinessBadge'
import { adminData } from '../../../lib/adminData'
import { requireAdminPage } from '../../../lib/auth/guards'

export const metadata: Metadata = { title: 'الإعدادات' }

export default async function SettingsPage() {
  await requireAdminPage()

  const settings = await adminData.getOperationalSettings()

  return (
    <>
      <PageHeader title="الإعدادات" description="الإشعارات وحالة التشغيل" actions={<ReadinessBadge />} />
      <div className="mb-4">
        <PreviewNotice what="تعديل إعدادات الإشعارات وتحديث كاش المتجر" />
      </div>
      <SettingsEditor settings={settings} />
    </>
  )
}
