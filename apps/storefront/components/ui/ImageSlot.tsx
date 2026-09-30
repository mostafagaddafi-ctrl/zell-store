import Image from 'next/image'
import { cn } from '../../lib/cn'

/**
 * خانة صورة بنسبة ثابتة.
 *
 * دلوقتي: بتعرض سطح هادي (والصور الحقيقية لسه مش متوصلة).
 * بعدين: بتمرر src وبس — من غير أي تعديل في التصميم ومن غير layout shift،
 * لأن المساحة محجوزة بالنسبة من دلوقتي.
 *
 * بتدعم شكلين من next/image:
 *   • fill  (الافتراضي) — مع sizes، للصور المتجاوبة
 *   • width/height       — للصور ذات المقاس الثابت زي اللوجو
 */

export type ImageRatio = '1/1' | '4/3' | '3/2' | '16/9' | '4/5' | 'auto'

const RATIO_CLASS: Record<ImageRatio, string> = {
  '1/1': 'aspect-square',
  '4/3': 'aspect-[4/3]',
  '3/2': 'aspect-[3/2]',
  '16/9': 'aspect-[16/9]',
  '4/5': 'aspect-[4/5]',
  auto: '',
}

export type ImageSlotProps = {
  ratio?: ImageRatio
  src?: string | null
  alt?: string
  width?: number
  height?: number
  sizes?: string
  priority?: boolean
  /** نص بديل صغير يظهر لحد ما الصورة تتوصل */
  label?: string
  labelClassName?: string
  className?: string
  imageClassName?: string
}

export function ImageSlot({
  ratio = '4/3',
  src,
  alt = '',
  width,
  height,
  sizes = '100vw',
  priority = false,
  label,
  labelClassName,
  className,
  imageClassName,
}: ImageSlotProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded bg-border/50',
        RATIO_CLASS[ratio],
        className,
      )}
    >
      {src && typeof width === 'number' && typeof height === 'number' ? (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          className={cn('h-full w-full object-contain', imageClassName)}
        />
      ) : src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn('object-cover', imageClassName)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          {label ? (
            <span className={cn('px-3 text-center text-xs text-muted', labelClassName)}>{label}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}
