import type { Metadata } from 'next'
import { CollectionEditor } from '../../../../components/collections/CollectionEditor'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { adminData } from '../../../../lib/adminData'
import { requireAdminPage } from '../../../../lib/auth/guards'

export const metadata: Metadata = { title: 'قسم جديد' }

export default async function NewCollectionPage() {
  await requireAdminPage()

  // المنتجات بتتجلب هنا كمان عشان المحرّر مكوّن واحد للحالتين
  const products = await adminData.listProducts()

  return (
    <>
      <PageHeader title="قسم جديد" description="احفظ البيانات الأول، وبعدها ضيف المنتجات والصورة" />
      <CollectionEditor collection={null} products={products} />
    </>
  )
}
