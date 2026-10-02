import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CollectionEditor } from '../../../../components/collections/CollectionEditor'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { adminData } from '../../../../lib/adminData'
import { requireAdminPage } from '../../../../lib/auth/guards'

type Params = { id: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params
  const collection = await adminData.getCollection(id)
  return { title: collection ? collection.title : 'القسم مش موجود' }
}

export default async function CollectionPage({ params }: { params: Promise<Params> }) {
  await requireAdminPage()

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
}
