import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { CollectionsList } from '../../../components/collections/CollectionsList'
import { HomeProductsEditor } from '../../../components/collections/HomeProductsEditor'
import { readHomeProducts } from '../../../lib/mutations/homeProducts'
import { PageHeader } from '../../../components/shell/PageHeader'
import { buttonClasses } from '../../../components/ui/Button'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { requireAdminPage } from '../../../lib/auth/guards'

export const metadata: Metadata = { title: 'الأقسام' }

export default async function CollectionsPage() {
  await requireAdminPage()

  const [collections, home] = await Promise.all([adminData.listCollections(), readHomeProducts()])

  return (
    <>
      <PageHeader
        title="الأقسام"
        description="الترتيب هنا هو ترتيب الظهور في الرئيسية والقائمة. القسم الجديد بيبدأ أول القائمة."
        actions={
          <Link href="/collections/new" className={buttonClasses('primary', 'md')}>
            <Plus className="h-4 w-4" />
            قسم جديد
          </Link>
        }
      />

      <div className="mb-4">
        <PreviewNotice what="الإضافة والتعديل والإظهار والترتيب وربط المنتجات وصور الأقسام" />
      </div>

      <div className="mb-4">
        <HomeProductsEditor initial={home.settings} products={home.products} />
      </div>

      <CollectionsList collections={collections} />
    </>
  )
}
