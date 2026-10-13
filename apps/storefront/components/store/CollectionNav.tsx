import Image from 'next/image'
import Link from 'next/link'
import type { StoreCollection } from '@zell/core'
import { cn } from '../../lib/cn'

/**
 * شريط «تسوّق حسب القسم» — صورة دايرية + اسم لكل قسم.
 *
 * في الرئيسية تحت الواجهة، وفوق كل صفحة قسم (القسم الحالي متعلّم عليه)
 * عشان الزائر يتنقّل من قسم لقسم من غير ما يرجع للرئيسية.
 *
 * الأقسام = المفعّلة للقائمة (ليها صفحة)، بنفس ترتيب اللوحة وصورها
 * (الغلاف أو أول صورة منتج). أقل من قسمين = مفيش شريط — قسم واحد
 * مش محتاج تنقّل. على الموبايل بيتسحب يمين وشمال.
 *
 * HOME-MOBILE §٤: دواير ستوريز في كل مكان وكل المقاسات (قسم من غير صورة = خلفية bg-border/50 من غير اسم جوه).
 */
export function CollectionNav({
  collections,
  currentSlug,
  title,
  className,
}: {
  collections: StoreCollection[]
  currentSlug?: string
  title?: string
  /** HOME-MOBILE — كلاسات زيادة على الـ nav (مكان الشريط في الرئيسية حسب الوضع). */
  className?: string
}) {
  const items = collections.filter((collection) => collection.showInNav)
  if (items.length < 2) return null

  return (
    <nav aria-label="الأقسام" className={cn('py-4 md:py-6', className)}>
      {title ? <h2 className="mb-3 text-base font-bold text-fg md:text-lg">{title}</h2> : null}
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
        {items.map((collection) => {
          const active = collection.slug === currentSlug
          const src = collection.image?.url ?? null
          return (
            <li key={collection.slug} className="w-[4.75rem] shrink-0 snap-start sm:w-24">
              <Link
                href={'/collection/' + collection.slug}
                aria-current={active ? 'page' : undefined}
                className="group block text-center"
              >
                {/* HOME-MOBILE §٤ — دواير ستوريز: إطار متدرّج (القسم الحالي لون واحد)، والصورة جوه بحد بلون الخلفية */}
                <span
                  className={cn(
                    'block rounded-full p-[2.5px] transition-transform group-active:scale-95',
                    active ? 'bg-brand' : 'bg-gradient-to-tr from-gold via-accent to-brand',
                  )}
                >
                  <span
                    className={cn(
                      'relative block aspect-square overflow-hidden rounded-full border-[3px] border-bg',
                      src === null && 'bg-border/50',
                    )}
                  >
                    {src !== null ? <Image src={src} alt="" fill sizes="96px" className="object-cover" /> : null}
                  </span>
                </span>
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
