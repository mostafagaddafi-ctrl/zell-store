import type { Metadata } from 'next'
import { InstallationEditor } from '../../../components/installation/InstallationEditor'
import { PageHeader } from '../../../components/shell/PageHeader'
import { requireAdminPage } from '../../../lib/auth/guards'
import { readInstallation } from '../../../lib/mutations/installation'

export const metadata: Metadata = { title: 'فني التركيب' }
export const dynamic = 'force-dynamic'

export default async function InstallationPage() {
  await requireAdminPage()
  const { settings, governorates } = await readInstallation()

  return (
    <>
      <PageHeader
        title="فني التركيب"
        description="الزبون بيطلب فني من صفحة الطلب، والطلب بيوصلك عليه علامة 🔧 — والسعر والمعاد بالتواصل"
      />
      <InstallationEditor initial={settings} governorates={governorates} />
    </>
  )
}
