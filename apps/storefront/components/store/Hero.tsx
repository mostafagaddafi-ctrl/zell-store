import Link from 'next/link'
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
 *
 * ⚠️ «نص العرض» اتنقل لشريط الهدية فوق الهيدر (AnnouncementBar) —
 *    مكانه الطبيعي أول حاجة في الصفحة، ومايتكررش هنا.
 */
export function Hero({ image }: { image: StoreImage | null }) {
  return (
    <section className="grid items-center gap-6 py-8 md:grid-cols-2 md:gap-12 md:py-14">
      <div className="space-y-4">
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
