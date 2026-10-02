import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import type { StoreProduct } from '@zell/core'
import { ProductCard } from '../../../components/store/ProductCard'
import { Container } from '../../../components/ui/Container'
import { ImageSlot } from '../../../components/ui/ImageSlot'
import { getStorefrontData } from '../../../lib/data/source'

/**
 * صفحة قسم.
 *
 * ⚠️ الصفحة موجودة بس للأقسام المفعّلة في القائمة (showInNav). قسم
 *    مفعّل للرئيسية بس بيرجّع 404 هنا — والرئيسية مابتحطّلوش رابط
 *    «شوف الكل» أصلًا، فمفيش رابط داخلي بيوصل لصفحة مش موجودة.
 */

type Params = { slug: string }

async function findCollection(slug: string) {
  const { collections, products } = await getStorefrontData()
  const collection = collections.find((item) => item.slug === slug && item.showInNav)
  if (!collection) return null

  const byId = new Map(products.map((product) => [product.id, product]))
  const items = collection.productIds
    .map((id) => byId.get(id))
    .filter((product): product is StoreProduct => product !== undefined)

  return { collection, items }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const found = await findCollection(slug)
  if (!found) return { title: 'القسم مش موجود' }

  const metadata: Metadata = { title: found.collection.title }
  if (found.collection.subtitle !== '') metadata.description = found.collection.subtitle
  return metadata
}

export default async function CollectionPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const found = await findCollection(slug)
  if (!found) notFound()

  const { collection, items } = found
  const image = collection.image

  return (
    <Container className="pb-8">
      <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-accent"
        >
          <ArrowRight className="h-4 w-4" />
          الرئيسية
        </Link>
        <Link
          href="/collections"
          className="text-sm font-medium text-muted transition-colors hover:text-accent"
        >
          كل الأقسام
        </Link>
      </nav>

      <header className="grid gap-5 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-10 md:py-8">
        <div className="min-w-0">
          <h1 className="text-display font-extrabold text-fg">{collection.title}</h1>
          {collection.subtitle ? (
            <p className="mt-2 max-w-md text-base leading-relaxed text-muted">{collection.subtitle}</p>
          ) : null}
        </div>

        {image ? (
          <ImageSlot
            ratio="16/9"
            fit="cover"
            src={image.url}
            alt={collection.hasCover ? image.alt : ''}
            sizes="(min-width: 768px) 352px, 100vw"
            priority
            className="rounded-lg border border-border"
          />
        ) : null}
      </header>

      <div className="grid gap-5 pb-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </Container>
  )
}
