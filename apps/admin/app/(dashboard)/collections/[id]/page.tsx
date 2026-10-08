import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CollectionEditor } from '../../../../components/collections/CollectionEditor'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { adminData } from '../../../../lib/adminData'
import { pageWithAccess } from '../../../../lib/access/instance'

type Params = { id: string }

export const metadata: Metadata = { title: 'القسم' }

export default pageWithAccess('zell.collections.view', async function CollectionPage(_ctx, { params }: { params: Promise<Params> }) {
  const { id } = await params
  const [collection, products] = await Promise.all([adminData.getCollection(id), adminData.listProducts()])
  if (!collection) notFound()

  return (
    <>
      <PageHeader
        title={collection.title}
        description={'/collection/' + collection.slug}
      />
      <CollectionEditor collection={collection} products={products} />
    </>
  )
})
