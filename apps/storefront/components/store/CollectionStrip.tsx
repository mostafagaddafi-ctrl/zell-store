import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { StoreCollection, StoreProduct } from '@zell/core'
import { ImageSlot } from '../ui/ImageSlot'
import { ProductCard } from './ProductCard'

/**
 * قسم في الصفحة الرئيسية: الصورة والعنوان والوصف، وبعدهم المنتجات.
 *
 * الصورة:
 *   غلاف مرفوع  -> بانر عريض فوق العنوان
 *   بديل تلقائي -> صورة صغيرة جنب العنوان (هي نفسها صورة أول منتج،
 *                  فبانر كبير منها كان هيكرّر الكارت اللي تحته)
 *
 * ⚠️ «شوف الكل» بيظهر بس لو القسم ليه صفحة (showInNav). قسم مفعّل
 *    للرئيسية بس مالوش صفحة، فبيعرض كل منتجاته هنا بدل رابط بيودّي 404.
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

  const hasPage = collection.showInNav
  const shown = hasPage ? items.slice(0, MAX_ON_HOME) : items
  const hasMore = hasPage && items.length > shown.length
  const headingId = 'collection-' + collection.slug
  const image = collection.image

  return (
    <section aria-labelledby={headingId} className="py-10 md:py-14">
      {image && collection.hasCover ? (
        <ImageSlot
          ratio="auto"
          fit="cover"
          src={image.url}
          alt={image.alt}
          sizes="(min-width: 1280px) 1200px, 100vw"
          className="mb-5 aspect-[16/9] rounded-lg border border-border sm:aspect-[21/9] md:aspect-[3/1]"
        />
      ) : null}

      <div className="flex items-center gap-3 sm:gap-4">
        {image && !collection.hasCover ? (
          <ImageSlot
            ratio="1/1"
            fit="cover"
            src={image.url}
            alt=""
            sizes="80px"
            className="h-14 w-14 shrink-0 rounded-lg border border-border sm:h-16 sm:w-16"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-xl font-bold text-fg md:text-2xl">
            {collection.title}
          </h2>
          {collection.subtitle ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted">{collection.subtitle}</p>
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

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
        {shown.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}
