import type { Metadata } from 'next'
import { InstallationEditor } from '../../../components/installation/InstallationEditor'
import { PageHeader } from '../../../components/shell/PageHeader'
import { pageWithAccess } from '../../../lib/access/instance'
import { readInstallation } from '../../../lib/data/installation'

export const metadata: Metadata = { title: 'فني التركيب' }
export const dynamic = 'force-dynamic'

export default pageWithAccess('zell.installation.view', async function InstallationPage(_ctx) {
  const { record, groups } = await readInstallation()

  return (
    <>
      <PageHeader
        title="فني التركيب"
        description="سعر تركيب المتر، والمناطق المتاحة للفني، ومصاريف انتقاله لكل منطقة — أسماء المناطق من صفحة الشحن"
      />
      {/* key = الطابع: «تجاهل وحدّث» بيجيب نسخة السيرفر في محرر جديد */}
      <InstallationEditor key={record.updatedAt ?? 'new'} initial={record} groups={groups} />
    </>
  )
})
