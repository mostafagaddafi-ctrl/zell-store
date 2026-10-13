import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import type { StoreProduct } from '@zell/core'
import { CollectionNav } from '../../../components/store/CollectionNav'
import { ProductCard } from '../../../components/store/ProductCard'
import { Container } from '../../../components/ui/Container'
import { getStorefrontData } from '../../../lib/data/source'

/**
 * صفحة قسم.
 *
 * ⚠️ الصفحة موجودة بس للأقسام المفعّلة في القائمة (showInNav). قسم
 *    مفعّل للرئيسية بس بيرجّع 404 هنا — والرئيسية مابتحطّلوش رابط
 *    «شوف الكل» أصلًا، فمفيش رابط داخلي بيوصل لصفحة مش موجودة.
 *
 * الـ header = العنوان والوصف بس لكل الأقسام (قرار المالك): من غير صورة الغلاف — الغلاف مكانه الرئيسية (#137).
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
  // نفس البيانات المكاشة — مفيش طلب زيادة
  const { collections } = await getStorefrontData()
  // 0017 — شكل العرض من اللوحة. قسم فيه منتج ظاهر واحد بيتعرض كروت كبيرة دايمًا.
  const compact = collection.catalogLayout === 'compact' && items.length > 1

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

      {/* التنقّل من قسم لقسم من غير الرجوع للرئيسية */}
      <CollectionNav collections={collections} currentSlug={collection.slug} />

      <header className="py-6 md:py-8">
        <h1 className="text-display font-extrabold text-fg">{collection.title}</h1>
        {collection.subtitle ? (
          <p className="mt-2 max-w-md text-base leading-relaxed text-muted">{collection.subtitle}</p>
        ) : null}
      </header>

      {compact ? (
        <div className="grid grid-cols-2 gap-2.5 pb-6 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} density="compact" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 pb-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </Container>
  )
}
