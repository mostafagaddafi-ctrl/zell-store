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

  // منتج تاني أو صور اتغيّرت = معرض جديد من الأول، فمفيش حالة بتعدّي من منتج للتاني
  const galleryKey = String(product.id) + ':' + shots.map((shot) => shot.src ?? '').join('|')
  return <GalleryView key={galleryKey} shots={shots} />
}

function GalleryView({ shots }: { shots: Shot[] }) {
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

  const frame = useHeldSwitch(index, 0)

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
      {/* الموبايل: إطار 4:3 بحد ٥٠vh والصورة كاملة (contain) — مفيش قص، والاسم والسعر بيطلعوا أسرع.
          من sm: نفس الشكل القديم (مربع، والصورة الأولى cover). زرار التكبير زي ما هو. */}
      <div className="relative mx-auto w-full max-w-[560px]">
        {hasMany ? (
          <HeldLayers
            shots={shots}
            requested={index}
            held={frame}
            sizes="(min-width: 1024px) 560px, 100vw"
            priorityFirst
            label="صورة المنتج"
            className="aspect-[4/3] max-h-[50vh] border border-border max-sm:bg-bg sm:aspect-square sm:max-h-none"
            imageClassName="max-sm:object-contain"
          />
        ) : (
          <ImageSlot
            ratio="1/1"
            fit={active.fit}
            src={active.src}
            alt={active.alt}
            sizes="(min-width: 1024px) 560px, 100vw"
            priority
            label="صورة المنتج"
            className="aspect-[4/3] max-h-[50vh] border border-border max-sm:bg-bg sm:aspect-square sm:max-h-none"
            imageClassName="max-sm:object-contain"
          />
        )}

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
        <ul className="mx-auto flex max-w-[560px] gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {shots.map((shot, shotIndex) => (
            <li key={shotIndex} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(shotIndex)}
                aria-label={'صورة رقم ' + String(shotIndex + 1)}
                aria-current={shotIndex === index}
                className={cn(
                  'block h-14 w-14 overflow-hidden rounded border transition-colors sm:h-[76px] sm:w-[76px]',
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
            <ZoomImage shots={shots} requested={index} startShown={frame.shown} />

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

type SettleState = 'ready' | 'failed'
type Held = {
  shown: number
  settled: ReadonlyMap<number, SettleState>
  settle: (shotIndex: number, state: SettleState) => void
}

/**
 * التقليب من غير مشهد مخلوط (فحص 2026-10-25): الصورة الظاهرة بتفضل زي ما هي لحد ما المطلوبة
 * تتحمّل وتتفك (decode) أو يفشل تحميلها. الضغط السريع: آخر طلب بس هو اللي بيظهر.
 * مفيش تحميل مسبق: بيتحمّل بس الظاهرة والمطلوبة، واللي اتحمّلت بتفضل موجودة للرجوع ليها.
 */
function useHeldSwitch(requested: number, initialShown: number): Held {
  const [settled, setSettled] = useState<ReadonlyMap<number, SettleState>>(() => new Map())
  const [held, setHeld] = useState(initialShown)
  const shown = settled.has(requested) ? requested : held
  // الظاهرة دلوقتي هي اللي هتفضل ثابتة لو الطلب الجاي لسه ماجهزش
  if (shown !== held) setHeld(shown)

  const settle = useCallback((shotIndex: number, state: SettleState) => {
    setSettled((current) =>
      current.get(shotIndex) === state ? current : new Map(current).set(shotIndex, state),
    )
  }, [])

  return { shown, settled, settle }
}

/** كل صورة طبقة بشكلها الثابت (cover/contain والمسافة)، والظاهرة بس هي اللي ليها مكان في الإطار. */
function HeldLayers({
  shots,
  requested,
  held,
  sizes,
  priorityFirst = false,
  label,
  className,
  imageClassName,
}: {
  shots: Shot[]
  requested: number
  held: Held
  sizes: string
  priorityFirst?: boolean
  label?: string
  className?: string
  imageClassName?: string
}) {
  return (
    <div className="relative">
      {shots.map((shot, shotIndex) => {
        const state = held.settled.get(shotIndex)
        if (shotIndex !== held.shown && shotIndex !== requested && state === undefined) return null
        const isShown = shotIndex === held.shown
        return (
          <div
            key={shotIndex}
            aria-hidden={isShown ? undefined : true}
            className={isShown ? 'relative' : 'pointer-events-none absolute inset-0 opacity-0'}
          >
            <ImageSlot
              ratio="1/1"
              fit={shot.fit}
              src={state === 'failed' ? null : shot.src}
              alt={isShown ? shot.alt : ''}
              sizes={sizes}
              priority={priorityFirst && shotIndex === 0}
              onLoad={(event) => {
                // جاهزة = اتحمّلت واتفكّت. رفض decode() فشل واضح، مش نجاح
                event.currentTarget.decode().then(
                  () => held.settle(shotIndex, 'ready'),
                  () => held.settle(shotIndex, 'failed'),
                )
              }}
              onError={() => held.settle(shotIndex, 'failed')}
              label={label}
              className={className}
              imageClassName={imageClassName}
            />
          </div>
        )
      })}
    </div>
  )
}

/** التكبير بنفس الضمان: بيبدأ بالصورة الظاهرة في الإطار، وبيحمّل نسخة التكبير للمطلوبة بس. */
function ZoomImage({ shots, requested, startShown }: { shots: Shot[]; requested: number; startShown: number }) {
  const held = useHeldSwitch(requested, startShown)
  const active = shots[requested] ?? shots[0]
  if (!active) return null
  if (shots.length < 2) {
    return (
      <ImageSlot
        ratio="1/1"
        fit={active.fit}
        src={active.src}
        alt={active.alt}
        sizes="(min-width: 768px) 672px, 100vw"
        className="bg-card"
      />
    )
  }
  return (
    <HeldLayers
      shots={shots}
      requested={requested}
      held={held}
      sizes="(min-width: 768px) 672px, 100vw"
      className="bg-card"
    />
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
