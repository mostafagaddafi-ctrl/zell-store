import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import type { StoreProduct } from '@zell/core'
import { ProductCard } from '../../../components/store/ProductCard'
import { Container } from '../../../components/ui/Container'
import { getStorefrontData } from '../../../lib/data/source'

/**
 * صفحة مجموعة.
 *
 * ⚠️ مفيش redirects ولا slugs قديمة في v1 — قرار معتمد. تغيير الـslug
 *    بيكسر الروابط القديمة، فالأدمن المفروض يعرف كده. (القيد في 0010
 *    بيمنع الأشكال الغلط بس، مش التغيير.)
 *
 * ⚠️ generateStaticParams مش مستخدمة عن قصد: المجموعات بيتغيّروا من
 *    اللوحة، والصفحة بتتجدد بنفس REVALIDATE_SECONDS زي باقي المتجر.
 *    توليد ثابت وقت البناء كان هيخلّي مجموعة جديدة 404 لحد النشر الجاي.
 */
type Params = { slug: string }

async function findCollection(slug: string) {
  const { collections, products } = await getStorefrontData()
  const collection = collections.find((item) => item.slug === slug)
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
  if (!found) return { title: 'المجموعة مش موجودة' }

  const metadata: Metadata = { title: found.collection.title }
  if (found.collection.subtitle !== '') metadata.description = found.collection.subtitle
  return metadata
}

export default async function CollectionPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const found = await findCollection(slug)

  // مجموعة مخفية أو فاضية = مش موجودة للزائر. تمييزها بصفحة فاضية
  // كان هيكشف وجودها من غير فايدة.
  if (!found) notFound()

  const { collection, items } = found

  return (
    <Container className="pb-8">
      <nav aria-label="مسار التنقل" className="pt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-accent"
        >
          <ArrowRight className="h-4 w-4" />
          الرئيسية
        </Link>
      </nav>

      <header className="py-6 md:py-8">
        <h1 className="text-display font-extrabold text-fg">{collection.title}</h1>
        {collection.subtitle ? (
          <p className="mt-2 max-w-md text-base leading-relaxed text-muted">{collection.subtitle}</p>
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
