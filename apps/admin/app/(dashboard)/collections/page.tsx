import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { CollectionsList } from '../../../components/collections/CollectionsList'
import { PageHeader } from '../../../components/shell/PageHeader'
import { buttonClasses } from '../../../components/ui/Button'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { requireAdminPage } from '../../../lib/auth/guards'

export const metadata: Metadata = { title: 'المجموعات' }

export default async function CollectionsPage() {
  await requireAdminPage()

  const collections = await adminData.listCollections()

  return (
    <>
      <PageHeader
        title="المجموعات"
        description="الترتيب هنا هو ترتيب ظهور المجموعات في الصفحة الرئيسية"
        actions={
          <Link href="/collections/new" className={buttonClasses('primary', 'md')}>
            <Plus className="h-4 w-4" />
            مجموعة جديدة
          </Link>
        }
      />

      <div className="mb-4">
        <PreviewNotice what="الإضافة والتعديل والإظهار والترتيب وربط المنتجات" />
      </div>

      <CollectionsList collections={collections} />
    </>
  )
}
