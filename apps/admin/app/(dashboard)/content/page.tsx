import type { Metadata } from 'next'
import { PageHeader } from '../../../components/shell/PageHeader'
import { ContentEditor } from '../../../components/content/ContentEditor'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { pageWithAccess } from '../../../lib/access/instance'

export const metadata: Metadata = { title: 'محتوى المتجر' }

export default pageWithAccess('zell.content.view', async function ContentPage(_ctx) {
  const content = await adminData.getContent()

  return (
    <>
      <PageHeader title="محتوى المتجر" description="النصوص والأقسام اللي بتظهر للزبون" />
      <div className="mb-4">
        <PreviewNotice what="تعديل نصوص المتجر وترتيب الأقسام" />
      </div>
      <ContentEditor content={content} />
    </>
  )
})
