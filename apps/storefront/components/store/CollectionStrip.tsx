import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { StoreCollection, StoreProduct } from '@zell/core'
import { ProductCard } from './ProductCard'

/**
 * قسم مجموعة على الصفحة الرئيسية.
 *
 * ⚠️ بياخد المنتجات من القائمة اللي الصفحة عندها أصلاً — مفيش طلب
 *    إضافي لكل مجموعة. الترتيب من productIds مش من ترتيب المنتجات
 *    العام، لأن ترتيب المجموعة قرار منفصل في اللوحة.
 *
 * ⚠️ أقصى أربع بطاقات على الرئيسية. المجموعة اللي فيها أكتر بيظهر
 *    معاها رابط «شوف الكل» لصفحتها. الرئيسية مش مكان كل المنتجات.
 */
const MAX_ON_HOME = 4

export function CollectionStrip({
  collection,
  products,
}: {
  collection: StoreCollection
  products: StoreProduct[]
}) {
  const byId = new Map(products.map((product) => [product.id, product]))
  const items = collection.productIds
    .map((id) => byId.get(id))
    .filter((product): product is StoreProduct => product !== undefined)

  if (items.length === 0) return null

  const shown = items.slice(0, MAX_ON_HOME)
  const hasMore = items.length > shown.length

  return (
    <section className="py-10 md:py-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-fg md:text-2xl">{collection.title}</h2>
          {collection.subtitle ? (
            <p className="mt-1 text-sm text-muted">{collection.subtitle}</p>
          ) : null}
        </div>

        {hasMore ? (
          <Link
            href={'/collection/' + collection.slug}
            className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-accent transition-colors hover:text-brand"
          >
            شوف الكل
            <ArrowLeft className="h-4 w-4" />
          </Link>
        ) : null}
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}
