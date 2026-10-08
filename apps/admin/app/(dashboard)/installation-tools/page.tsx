import type { Metadata } from 'next'
import { ToolsPageEditor } from '../../../components/installation/ToolsPageEditor'
import { PageHeader } from '../../../components/shell/PageHeader'
import { pageWithAccess } from '../../../lib/access/instance'
import { readInstallationToolsPage, readToolsSummary } from '../../../lib/data/installationToolsPage'

export const metadata: Metadata = { title: 'أدوات التركيب' }
export const dynamic = 'force-dynamic'

export default pageWithAccess('zell.installation_tools.view', async function InstallationToolsSettingsPage(_ctx) {
  const [record, summary] = await Promise.all([readInstallationToolsPage(), readToolsSummary()])

  return (
    <>
      <PageHeader
        title="أدوات التركيب"
        description="صفحة في المتجر بالأدوات والباكدجات المناسبة لكل فيلم — المحتوى من هنا، والربط من صفحة كل فيلم"
      />
      {/* key = الطابع: «تجاهل وحدّث» بيجيب نسخة السيرفر في محرر جديد */}
      <ToolsPageEditor key={record.updatedAt ?? 'new'} initial={record} summary={summary} />
    </>
  )
})
