import type { Metadata } from 'next'
import { PageHeader } from '../../components/shell/PageHeader'
import { ContentEditor } from '../../components/content/ContentEditor'
import { PreviewNotice } from '../../components/ui/PreviewNotice'
import { adminData } from '../../lib/adminData'

export const metadata: Metadata = { title: 'محتوى المتجر' }

export default async function ContentPage() {
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
}
