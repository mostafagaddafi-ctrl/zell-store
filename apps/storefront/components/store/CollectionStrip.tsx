import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { StoreCollection, StoreImage, StoreProduct } from '@zell/core'
import { cn } from '../../lib/cn'
import { ImageSlot } from '../ui/ImageSlot'
import { ProductCard } from './ProductCard'

/**
 * قسم في الصفحة الرئيسية: الصورة والعنوان والوصف، وبعدهم المنتجات.
 *
 * الصورة:
 *   غلاف مرفوع  -> الغلاف هو راس القسم: العنوان والوصف مكتوبين على الصورة من تحت (تدرّج غامق
 *                  وراهم علشان يتقروا على أي صورة)، والمنتجات تحته على طول
 *   بديل تلقائي -> صورة صغيرة جنب العنوان (هي نفسها صورة أول منتج،
 *                  فبانر كبير منها كان هيكرّر الكارت اللي تحته)
 *
 * ⚠️ «شوف الكل» بيظهر بس لو القسم ليه صفحة (showInNav). قسم مفعّل
 *    للرئيسية بس مالوش صفحة، فبيعرض كل منتجاته هنا بدل رابط بيودّي 404.
 *    في الغلاف: ليه صفحة = الغلاف كله لينك + زرار «شوف الكل» في الركن؛ مالوش = نفس الشكل من غير لينك.
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
  const cover = image && collection.hasCover ? image : null

  return (
    <section aria-labelledby={headingId} className="py-10 md:py-14">
      {cover ? (
        <CoverHeader
          image={cover}
          title={collection.title}
          subtitle={collection.subtitle}
          headingId={headingId}
          href={hasPage ? '/collection/' + collection.slug : null}
        />
      ) : (
        <div className="flex items-center gap-3 sm:gap-4">
          {image ? (
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
      )}

      <div className={cn('grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3', cover ? 'mt-4' : 'mt-6')}>
        {shown.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}

/**
 * راس القسم لما يكون ليه غلاف: الصورة بنفس المقاسات القديمة (16:9 · 21:9 · 3:1)، والعنوان (h2 بنفس
 * headingId) والوصف أبيض على تدرّج غامق من تحت لفوق. الصورة alt="" لأن العنوان هو اسم الرابط/القسم.
 * href = null (القسم مالوش صفحة): نفس الشكل من غير لينك ولا زرار ولا تكبير.
 */
function CoverHeader({
  image,
  title,
  subtitle,
  headingId,
  href,
}: {
  image: StoreImage
  title: string
  subtitle: string
  headingId: string
  href: string | null
}) {
  const linked = href !== null
  const body = (
    <>
      <Image
        src={image.url}
        alt=""
        fill
        sizes="(min-width: 1280px) 1200px, 100vw"
        className={cn('object-cover', linked && 'transition-transform duration-500 motion-safe:group-hover:scale-[1.03]')}
      />
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 sm:p-6">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-xl font-bold text-white md:text-3xl">
            {title}
          </h2>
          {subtitle ? <p className="mt-1 line-clamp-2 text-sm text-white/85 md:text-base">{subtitle}</p> : null}
        </div>
        {linked ? (
          <span className="flex shrink-0 items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand shadow-card sm:text-sm">
            شوف الكل
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </>
  )

  const frame = 'relative block aspect-[16/9] overflow-hidden rounded-xl bg-border/50 sm:aspect-[21/9] md:aspect-[3/1]'

  return linked ? (
    <Link
      href={href}
      className={cn(frame, 'group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2')}
    >
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  )
}
