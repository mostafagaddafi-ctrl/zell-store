import type { Metadata } from 'next'
import { PolicyPagesEditor } from '../../../components/content/PolicyPagesEditor'
import { PageHeader } from '../../../components/shell/PageHeader'
import { pageWithAccess } from '../../../lib/access/instance'
import { readPolicyPages } from '../../../lib/data/policyPages'

export const metadata: Metadata = { title: 'السياسات' }
export const dynamic = 'force-dynamic'

/** POLICY-PAGES (docs/contracts/POLICY-PAGES.md §٤) — القراءة zell.content.view، والحفظ والتفعيل zell.content.edit. */
export default pageWithAccess('zell.content.view', async function PolicyPagesSettingsPage(_ctx) {
  const record = await readPolicyPages()

  return (
    <>
      <PageHeader
        title="السياسات"
        description="صفحات الشروط والأحكام والشحن والتوصيل والاستبدال والاسترجاع والخصوصية في المتجر. تبقى كل صفحة مخفية حتى تُفعَّل وتُحفظ."
      />
      {/* key = الطابع: «تجاهل وحدّث» بيجيب نسخة السيرفر في محرر جديد */}
      <PolicyPagesEditor key={record.updatedAt ?? 'new'} initial={{ pages: record.pages, updatedAt: record.updatedAt }} />
    </>
  )
})
