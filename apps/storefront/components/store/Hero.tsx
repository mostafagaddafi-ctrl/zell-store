import Link from 'next/link'
import { getImageProps } from 'next/image'
import { preload } from 'react-dom'
import type { HomeMobileLayout, StoreContent, StoreImage } from '@zell/core'
import { cn } from '../../lib/cn'
import { DESKTOP_MEDIA, HERO_IMAGE_SIZES, MOBILE_IMAGE_PLACEHOLDER } from '../../lib/home/homeLayout'
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
 *
 * HOME-MOBILE (layout = 'compact'، تحت sm بس): h1 للقارئ وجوجل بس (max-sm:sr-only)، والوصف والزرار مستخبيين،
 * والصورة **ماتتطلبش خالص** على الموبايل (DesktopHeroImage). من sm لفوق، وفي 'full'، كل حاجة زي قبل العقد بالحرف.
 */
export function Hero({ image, hero, layout = 'full' }: { image: StoreImage | null; hero: StoreContent['hero']; layout?: HomeMobileLayout }) {
  const compact = layout === 'compact'
  return (
    <section
      className={cn(
        image ? 'grid items-center gap-6 py-8 md:grid-cols-2 md:gap-12 md:py-14' : 'pb-2 pt-8 md:pt-12',
        // في compact الواجهة على الموبايل = h1 مخفي للعين بس، فمفيش مساحة فاضية
        compact && 'max-sm:p-0',
      )}
    >
      <div className="space-y-4">
        <h1 className={cn('text-display font-extrabold text-fg md:text-display-lg', compact && 'max-sm:sr-only')}>
          {hero.title}
          {hero.accent ? (
            <>
              {' '}
              <span className="text-brand">{hero.accent}</span>
            </>
          ) : null}
        </h1>

        {hero.subtitle ? (
          <p className={cn('max-w-md text-base leading-relaxed text-muted', compact && 'max-sm:hidden')}>{hero.subtitle}</p>
        ) : null}

        <Link href="#products" className={buttonClasses('primary', 'md', cn('w-full sm:w-auto', compact && 'max-sm:hidden'))}>
          {hero.ctaLabel}
        </Link>
      </div>

      {image ? (
        compact ? (
          <DesktopHeroImage image={image} />
        ) : (
          <ImageSlot
            ratio="4/3"
            fit="cover"
            src={image.url}
            alt={image.alt}
            sizes={HERO_IMAGE_SIZES}
            priority
            className="max-h-[360px] md:max-h-none"
          />
        )
      ) : null}
    </section>
  )
}

/**
 * صورة الواجهة في compact (§٣-١): picture فيه source للكمبيوتر بس (media sm)، والـ img الأساسي placeholder
 * data URI — فتحت 640px **مفيش أي طلب للشبكة**. على الكمبيوتر: preload بـ media sm وأولوية عالية (زي priority)،
 * ونفس إطار ImageSlot (4:3 · cover · bg-border/50).
 */
function DesktopHeroImage({ image }: { image: StoreImage }) {
  const { props } = getImageProps({ src: image.url, alt: image.alt, fill: true, sizes: HERO_IMAGE_SIZES })
  preload(props.src, {
    as: 'image',
    fetchPriority: 'high',
    media: DESKTOP_MEDIA,
    ...(props.srcSet ? { imageSrcSet: props.srcSet } : {}),
    ...(props.sizes ? { imageSizes: props.sizes } : {}),
  })
  return (
    <div className="relative hidden aspect-[4/3] max-h-[360px] overflow-hidden rounded bg-border/50 sm:block md:max-h-none">
      <picture>
        <source media={DESKTOP_MEDIA} srcSet={props.srcSet ?? props.src} sizes={props.sizes} />
        <img
          src={MOBILE_IMAGE_PLACEHOLDER}
          alt={image.alt}
          style={props.style}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="object-cover"
        />
      </picture>
    </div>
  )
}
