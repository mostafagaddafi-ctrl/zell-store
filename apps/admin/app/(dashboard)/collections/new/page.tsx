import type { Metadata } from 'next'
import { CollectionEditor } from '../../../../components/collections/CollectionEditor'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { adminData } from '../../../../lib/adminData'
import { pageWithAccess } from '../../../../lib/access/instance'

export const metadata: Metadata = { title: 'قسم جديد' }

export default pageWithAccess('zell.collections.view', async function NewCollectionPage(_ctx) {
  // المنتجات بتتجلب هنا كمان عشان المحرّر مكوّن واحد للحالتين
  const products = await adminData.listProducts()

  return (
    <>
      <PageHeader title="قسم جديد" description="احفظ البيانات الأول، وبعدها ضيف المنتجات والصورة" />
      <CollectionEditor collection={null} products={products} />
    </>
  )
})
