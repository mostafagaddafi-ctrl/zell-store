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
                {/* HOME-MOBILE §٤ — الدواير العادية إطار رفيع رمادي دافي فاتح (هادي)، والكحلي للقسم الحالي بس: إطار brand سادة أتخن + اسم bold + شرطة تحته */}
                <span
                  className={cn(
                    'block rounded-full transition-transform group-active:scale-95',
                    active ? 'bg-brand p-[3.5px]' : 'bg-[hsl(37_18%_80%)] p-[2.5px]',
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
                    'mt-1.5 block truncate text-xs transition-colors',
                    active ? 'font-bold text-brand' : 'font-semibold text-fg group-hover:text-accent',
                  )}
                >
                  {collection.title}
                </span>
                {active ? <span aria-hidden="true" className="mx-auto mt-1 block h-0.5 w-6 rounded-full bg-brand" /> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
