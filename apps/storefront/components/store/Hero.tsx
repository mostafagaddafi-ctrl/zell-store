import Link from 'next/link'
import { PackageCheck } from 'lucide-react'
import type { StoreImage } from '@zell/core'
import { buttonClasses } from '../ui/Button'
import { ImageSlot } from '../ui/ImageSlot'

/**
 * Hero مضغوط عن قصد: المنتجات لازم تبان بدري.
 * على الموبايل الصورة 4:3 ومحدودة بـ 360px ارتفاع، والنص قبلها.
 *
 * الصورة بتيجي من site_images (kind = 'hero' and is_active = true).
 * لو مفيش صورة نشطة، ImageSlot بتعرض الخانة البديلة بنصّها — نفس
 * السلوك القديم بالظبط، فغياب الصورة مش عطل.
 */
export function Hero({ offerText, image }: { offerText: string; image: StoreImage | null }) {
  return (
    <section className="grid items-center gap-6 py-8 md:grid-cols-2 md:gap-12 md:py-14">
      <div className="space-y-4">
        {offerText ? (
          <div className="flex max-w-md items-center gap-3 rounded-lg border border-gold/35 bg-card px-3 py-2.5 text-fg shadow-card">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gold/15 text-brand">
              <PackageCheck className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
            </span>
            <p className="text-sm font-bold leading-6">{offerText}</p>
            <span className="me-auto h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
          </div>
        ) : null}

        <h1 className="text-display font-extrabold text-fg md:text-display-lg">
          أفلام حماية الزجاج، <span className="text-brand">بالمتر</span>
        </h1>

        <p className="max-w-md text-base leading-relaxed text-muted">
          عزل حرارة، خصوصية، وتعتيم لشبابيك البيت. تدخل مقاس الشباك وإحنا نحسب الطول، والدفع عند
          الاستلام لكل محافظات مصر.
        </p>

        <Link href="#products" className={buttonClasses('primary', 'md', 'w-full sm:w-auto')}>
          اختار نوع الفيلم
        </Link>
      </div>

      <ImageSlot
        ratio="4/3"
        fit="cover"
        src={image?.url ?? null}
        alt={image?.alt ?? ''}
        sizes="(min-width: 768px) 50vw, 100vw"
        priority
        label="صورة الخامة على الشباك"
        className="max-h-[360px] md:max-h-none"
      />
    </section>
  )
}
