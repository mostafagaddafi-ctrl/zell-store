'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react'
import { galleryImages, type StoreProduct } from '@zell/core'
import { cn } from '../../lib/cn'
import { ImageSlot, type ImageFit } from '../ui/ImageSlot'

type Shot = { src: string | null; fit: ImageFit; alt: string }

/**
 * معرض مضغوط — الإطار مربع ثابت فمفيش layout shift وقت التبديل.
 *
 * الصورة الأولى (is_primary) هي مشهد الشباك ← cover.
 * باقي صور الرول ← contain عشان الخامة ما تتقصّش.
 */
export function ProductGallery({ product }: { product: StoreProduct }) {
  const shots = useMemo<Shot[]>(() => {
    const images = galleryImages(product)
    if (images.length === 0) return [{ src: null, fit: 'cover', alt: product.name_ar }]
    return images.map((image, index) => ({
      src: image.url,
      fit: index === 0 ? 'cover' : 'contain',
      alt: image.alt || product.name_ar,
    }))
  }, [product])

  const [index, setIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  const count = shots.length
  const active = shots[index] ?? shots[0]
  const hasMany = count > 1
  const canZoom = Boolean(active?.src)

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => (current + delta + count) % count)
    },
    [count],
  )

  // في RTL السهم اليمين معناه «السابق»
  useEffect(() => {
    if (!zoomed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomed(false)
      else if (event.key === 'ArrowRight') go(-1)
      else if (event.key === 'ArrowLeft') go(1)
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [zoomed, go])

  if (!active) return null

  return (
    <div className="space-y-3">
      <div className="relative mx-auto w-full max-w-[560px]">
        <ImageSlot
          ratio="1/1"
          fit={active.fit}
          src={active.src}
          alt={active.alt}
          sizes="(min-width: 1024px) 560px, 100vw"
          priority
          label="صورة المنتج"
          className="max-h-[380px] border border-border sm:max-h-none"
        />

        {canZoom ? (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label="كبّر الصورة"
            className="absolute bottom-3 left-3 flex h-10 items-center gap-2 rounded-lg bg-card/95 px-3 text-xs font-semibold text-fg shadow-card transition-colors hover:text-accent"
          >
            <Maximize2 className="h-4 w-4" />
            تكبير
          </button>
        ) : null}

        {hasMany ? (
          <>
            <GalleryArrow side="right" onClick={() => go(-1)} label="الصورة السابقة" />
            <GalleryArrow side="left" onClick={() => go(1)} label="الصورة التالية" />
          </>
        ) : null}
      </div>

      {hasMany ? (
        <ul className="mx-auto flex max-w-[560px] flex-wrap gap-2">
          {shots.map((shot, shotIndex) => (
            <li key={shotIndex}>
              <button
                type="button"
                onClick={() => setIndex(shotIndex)}
                aria-label={'صورة رقم ' + String(shotIndex + 1)}
                aria-current={shotIndex === index}
                className={cn(
                  'block h-[76px] w-[76px] overflow-hidden rounded border transition-colors',
                  shotIndex === index ? 'border-brand' : 'border-border hover:border-muted',
                )}
              >
                <ImageSlot
                  ratio="1/1"
                  fit={shot.fit}
                  src={shot.src}
                  alt=""
                  sizes="80px"
                  className="rounded-none"
                  imageClassName={shot.fit === 'contain' ? 'p-1' : ''}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {zoomed && active.src ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.alt}
          className="fixed inset-0 z-50 flex items-center justify-center bg-fg/80 p-4"
          onClick={() => setZoomed(false)}
        >
          <div className="relative w-full max-w-2xl" onClick={(event) => event.stopPropagation()}>
            <ImageSlot
              ratio="1/1"
              fit={active.fit}
              src={active.src}
              alt={active.alt}
              sizes="(min-width: 768px) 672px, 100vw"
              className="bg-card"
            />

            <button
              type="button"
              onClick={() => setZoomed(false)}
              aria-label="اقفل"
              className="absolute -top-12 left-0 flex h-10 w-10 items-center justify-center rounded-lg bg-card text-fg"
            >
              <X className="h-5 w-5" />
            </button>

            {hasMany ? (
              <>
                <GalleryArrow side="right" onClick={() => go(-1)} label="الصورة السابقة" />
                <GalleryArrow side="left" onClick={() => go(1)} label="الصورة التالية" />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GalleryArrow({
  side,
  onClick,
  label,
}: {
  side: 'right' | 'left'
  onClick: () => void
  label: string
}) {
  const Icon = side === 'right' ? ChevronRight : ChevronLeft
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-card/95 text-fg shadow-card transition-colors hover:text-accent',
        side === 'right' ? 'right-3' : 'left-3',
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}
