import Link from 'next/link'
import type { StoreCollection } from '@zell/core'
import { cn } from '../../lib/cn'
import { ImageSlot } from '../ui/ImageSlot'

/**
 * شريط «تسوّق حسب القسم» — صورة دايرية + اسم لكل قسم.
 *
 * في الرئيسية تحت الواجهة، وفوق كل صفحة قسم (القسم الحالي متعلّم عليه)
 * عشان الزائر يتنقّل من قسم لقسم من غير ما يرجع للرئيسية.
 *
 * الأقسام = المفعّلة للقائمة (ليها صفحة)، بنفس ترتيب اللوحة وصورها
 * (الغلاف أو أول صورة منتج). أقل من قسمين = مفيش شريط — قسم واحد
 * مش محتاج تنقّل. على الموبايل بيتسحب يمين وشمال.
 */
export function CollectionNav({
  collections,
  currentSlug,
  title,
}: {
  collections: StoreCollection[]
  currentSlug?: string
  title?: string
}) {
  const items = collections.filter((collection) => collection.showInNav)
  if (items.length < 2) return null

  return (
    <nav aria-label="الأقسام" className="py-4 md:py-6">
      {title ? <h2 className="mb-3 text-base font-bold text-fg md:text-lg">{title}</h2> : null}
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
        {items.map((collection) => {
          const active = collection.slug === currentSlug
          return (
            <li key={collection.slug} className="w-20 shrink-0 snap-start sm:w-24">
              <Link
                href={'/collection/' + collection.slug}
                aria-current={active ? 'page' : undefined}
                className="group block text-center"
              >
                <ImageSlot
                  ratio="1/1"
                  fit="cover"
                  src={collection.image?.url ?? null}
                  alt=""
                  sizes="96px"
                  label={collection.title}
                  labelClassName="text-[10px]"
                  className={cn(
                    'rounded-full border-2 transition-colors',
                    active ? 'border-brand' : 'border-border group-hover:border-accent',
                  )}
                />
                <span
                  className={cn(
                    'mt-1.5 block truncate text-xs font-semibold transition-colors',
                    active ? 'text-brand' : 'text-fg group-hover:text-accent',
                  )}
                >
                  {collection.title}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
