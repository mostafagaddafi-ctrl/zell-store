import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { CollectionsList } from '../../../components/collections/CollectionsList'
import { HomeProductsEditor } from '../../../components/collections/HomeProductsEditor'
import { readHomeProducts } from '../../../lib/data/homeProducts'
import { PageHeader } from '../../../components/shell/PageHeader'
import { buttonClasses } from '../../../components/ui/Button'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { pageWithAccess } from '../../../lib/access/instance'

export const metadata: Metadata = { title: 'الأقسام' }

export default pageWithAccess('zell.collections.view', async function CollectionsPage(_ctx) {
  const [collections, home] = await Promise.all([adminData.listCollections(), readHomeProducts()])

  return (
    <>
      <PageHeader
        title="الأقسام"
        description="يطابق هذا الترتيب ترتيب الظهور في الرئيسية والقائمة، ويظهر القسم الجديد في أول القائمة."
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
})
