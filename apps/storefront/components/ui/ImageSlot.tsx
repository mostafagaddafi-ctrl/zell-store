import Image from 'next/image'
import { cn } from '../../lib/cn'

/**
 * خانة صورة بنسبة ثابتة.
 *
 * الملفات الأصلية كلها **قريبة من المربع** (اللوجو والـ preview 1:1،
 * وصور الرول بين 1170×1280 و 1280×1160)، فالإطار الافتراضي مربع.
 * ممنوع إطار 3:2 — كان هيقص الـ preview المربعة من غير داعي.
 *
 * fit:
 *   cover   — مشهد الشباك (preview) يملا الإطار
 *   contain — صورة الرول/الخامة كاملة على خلفية دافية، من غير قص
 */

export type ImageRatio = '1/1' | '4/3' | '3/2' | '16/9' | '4/5' | 'auto'
export type ImageFit = 'cover' | 'contain'

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
  fit?: ImageFit
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
  ratio = '1/1',
  fit = 'cover',
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
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded',
        // الخامة المعروضة كاملة محتاجة خلفية دافية هادية حواليها
        fit === 'contain' ? 'bg-bg' : 'bg-border/50',
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
          className={cn('h-full w-full', fitClass, imageClassName)}
        />
      ) : src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn(fitClass, fit === 'contain' ? 'p-3' : '', imageClassName)}
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
