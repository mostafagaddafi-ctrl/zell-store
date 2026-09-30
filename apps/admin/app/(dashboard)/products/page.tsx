import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { PageHeader } from '../../../components/shell/PageHeader'
import { ProductsTable } from '../../../components/products/ProductsTable'
import { buttonClasses } from '../../../components/ui/Button'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { requireAdminPage } from '../../../lib/auth/guards'

export const metadata: Metadata = { title: 'المنتجات' }

export default async function ProductsPage() {
  await requireAdminPage()

  const products = await adminData.listProducts()

  return (
    <>
      <PageHeader
        title="المنتجات"
        description="الترتيب هنا هو نفس ترتيب الظهور في المتجر"
        actions={
          <Link href="/products/new" className={buttonClasses('primary', 'md')}>
            <Plus className="h-4 w-4" />
            منتج جديد
          </Link>
        }
      />

      <div className="mb-4">
        <PreviewNotice what="الإضافة والتعديل والإظهار والترتيب" />
      </div>

      <ProductsTable products={products} />
    </>
  )
}
