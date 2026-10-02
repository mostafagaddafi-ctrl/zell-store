import Link from 'next/link'
import type { StoreContent, StoreImage } from '@zell/core'
import { buttonClasses } from '../ui/Button'
import { ImageSlot } from '../ui/ImageSlot'

/**
 * Hero مضغوط عن قصد: المنتجات لازم تبان بدري.
 * على الموبايل الصورة 4:3 ومحدودة بـ 360px ارتفاع، والنص قبلها.
 *
 * النصوص من «المحتوى» في اللوحة (العنوان · الكلمة المميزة · الوصف ·
 * نص الزرار). الصورة من site_images (kind = 'hero').
 *
 * ⚠️ من غير صورة مرفوعة **مفيش خانة خالص**: الواجهة بتبقى نص بس وعمود
 *    واحد. الخانة الفاضية («صورة الخامة على الشباك») كانت بتاكل نص أول
 *    شاشة على الموبايل وبتبان كأن الموقع ناقص. أول ما صورة تترفع من
 *    الهوية بتظهر لوحدها بنفس التخطيط القديم (عمودين على الديسكتوب).
 *
 * «نص العرض» مش هنا — مكانه شريط الهدية فوق الهيدر (AnnouncementBar).
 */
export function Hero({ image, hero }: { image: StoreImage | null; hero: StoreContent['hero'] }) {
  return (
    <section
      className={
        image ? 'grid items-center gap-6 py-8 md:grid-cols-2 md:gap-12 md:py-14' : 'pb-2 pt-8 md:pt-12'
      }
    >
      <div className="space-y-4">
        <h1 className="text-display font-extrabold text-fg md:text-display-lg">
          {hero.title}
          {hero.accent ? (
            <>
              {' '}
              <span className="text-brand">{hero.accent}</span>
            </>
          ) : null}
        </h1>

        {hero.subtitle ? <p className="max-w-md text-base leading-relaxed text-muted">{hero.subtitle}</p> : null}

        <Link href="#products" className={buttonClasses('primary', 'md', 'w-full sm:w-auto')}>
          {hero.ctaLabel}
        </Link>
      </div>

      {image ? (
        <ImageSlot
          ratio="4/3"
          fit="cover"
          src={image.url}
          alt={image.alt}
          sizes="(min-width: 768px) 50vw, 100vw"
          priority
          className="max-h-[360px] md:max-h-none"
        />
      ) : null}
    </section>
  )
}
