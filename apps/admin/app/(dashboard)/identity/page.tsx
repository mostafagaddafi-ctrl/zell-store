import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { IdentityEditor } from '../../../components/identity/IdentityEditor'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { requireAdminPage } from '../../../lib/auth/guards'

export const metadata: Metadata = { title: 'هوية المتجر' }

export default async function IdentityPage() {
  await requireAdminPage()

  const identity = await adminData.getIdentity()

  return (
    <>
      <PageHeader title="هوية المتجر" description="اللوجو والاسم وبيانات التواصل" />
      <div className="mb-4">
        <PreviewNotice what="تعديل اللوجو وبيانات المتجر" />
      </div>
      <IdentityEditor identity={identity} />
    </>
  )
}
