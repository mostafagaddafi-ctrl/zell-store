'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react'
import { galleryImages, type StoreProduct } from '@zell/core'
import { cn } from '../../lib/cn'
import { IDLE_SWIPE, isSwipeIdle, reduceSwipe, swipeEnabled, type SwipeCommand, type SwipeEvent, type SwipeState } from '../../lib/gallery/swipe'
import { ImageSlot, type ImageFit } from '../ui/ImageSlot'

type Shot = { src: string | null; fit: ImageFit; alt: string }

/** GALLERY-SWIPE §٥ — السكرول الرأسي والتكبير بصباعين للمتصفح، والسحب الأفقي لينا. على السطحين بس. */
const SWIPE_SURFACE = '[touch-action:pan-y_pinch-zoom]'

function pageIsZoomed(): boolean {
  const viewport = typeof window === 'undefined' ? null : window.visualViewport
  return viewport !== null && viewport !== undefined && viewport.scale > 1
}

/** بداية اللمس على زرار أو رابط جوه السطح (الأسهم · «تكبير» · الإغلاق) = مش سحبة. */
function startsOnControl(target: EventTarget | null, surface: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  const control = target.closest('button, a')
  return control !== null && surface.contains(control)
}

/**
 * GALLERY-SWIPE (docs/contracts/GALLERY-SWIPE.md §٣–§٦) — غلاف رفيع حوالين reduceSwipe لسطح واحد.
 *
 * - الحالة في ref (من غير re-render). down على السطح بيبدأ، ومتابعة document (capture) للـ pointerdown/up/cancel
 *   وkeydown بتتركّب أول ما الحالة تبقى مش فاضية وبتتشال أول ما ترجع فاضية. الحدث ممكن يوصل مرتين (document + السطح)
 *   والـ reducer بيتجاهل التكرار.
 * - مفيش preventDefault على اللمس خالص؛ المنع للـ click اللي جاي من نفس السحبة بس (onClickCapture).
 * - reset (وفك الالتقاط والمتابعة) لما السحب يتقفل أو يتفتح، أو resetKey يتغيّر، أو الـ unmount.
 */
function useGallerySwipe(enabled: boolean, resetKey: unknown, onCommand: (command: SwipeCommand) => void) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<SwipeState>(IDLE_SWIPE)
  const commandRef = useRef(onCommand)
  const detachRef = useRef<(() => void) | null>(null)
  const dispatchRef = useRef<(event: SwipeEvent) => boolean>(() => false)

  useEffect(() => {
    commandRef.current = onCommand
  }, [onCommand])

  const detach = useCallback(() => {
    detachRef.current?.()
    detachRef.current = null
  }, [])

  const attach = useCallback(() => {
    if (detachRef.current !== null) return
    const onDown = (event: PointerEvent) => {
      const surface = surfaceRef.current
      const onSurface = surface !== null && event.target instanceof Node && surface.contains(event.target)
      dispatchRef.current({
        type: 'down',
        id: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
        onSurface,
        onControl: surface !== null && startsOnControl(event.target, surface),
        pageZoomed: pageIsZoomed(),
      })
    }
    const onUp = (event: PointerEvent) => {
      dispatchRef.current({ type: 'up', id: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, now: performance.now() })
    }
    const onCancel = (event: PointerEvent) => {
      dispatchRef.current({ type: 'cancel', id: event.pointerId, pointerType: event.pointerType })
    }
    const onKey = () => {
      dispatchRef.current({ type: 'key' })
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onCancel, true)
    document.addEventListener('keydown', onKey, true)
    detachRef.current = () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onCancel, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [])

  const dispatch = useCallback(
    (event: SwipeEvent): boolean => {
      const out = reduceSwipe(stateRef.current, event)
      stateRef.current = out.state
      if (isSwipeIdle(out.state)) detach()
      else attach()
      if (out.command !== null) commandRef.current(out.command)
      return out.preventClick
    },
    [attach, detach],
  )

  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])

  const reset = useCallback(() => {
    const surface = surfaceRef.current
    const tracking = stateRef.current.tracking
    if (surface !== null && tracking !== null && surface.hasPointerCapture(tracking.id)) {
      try {
        surface.releasePointerCapture(tracking.id)
      } catch {
        // الالتقاط اتفك لوحده
      }
    }
    stateRef.current = IDLE_SWIPE
    detach()
  }, [detach])

  useEffect(() => {
    reset()
    return reset
  }, [enabled, resetKey, reset])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    const surface = event.currentTarget
    dispatch({
      type: 'down',
      id: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      onSurface: true,
      onControl: startsOnControl(event.target, surface),
      pageZoomed: pageIsZoomed(),
    })
    if (stateRef.current.tracking?.id === event.pointerId) {
      try {
        surface.setPointerCapture(event.pointerId)
      } catch {
        // المتصفح رفض الالتقاط — السحبة لسه بتتحسب من متابعة document
      }
    }
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    dispatch({ type: 'up', id: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, now: performance.now() })
  }
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    dispatch({ type: 'cancel', id: event.pointerId, pointerType: event.pointerType })
  }
  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    dispatch({ type: 'lost', id: event.pointerId })
  }
  const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (dispatch({ type: 'click', now: performance.now(), detail: event.detail })) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return {
    surfaceRef,
    surfaceProps: enabled ? { onPointerDown, onPointerUp, onPointerCancel, onLostPointerCapture } : {},
    onClickCapture,
  }
}

/**
 * معرض مضغوط — الإطار مربع ثابت فمفيش layout shift وقت التبديل.
 *
 * الصورة الأولى (is_primary) هي مشهد الشباك ← cover.
 * باقي صور الرول ← contain عشان الخامة ما تتقصّش.
 *
 * GALLERY-SWIPE: سحب باللمس على الصورة الكبيرة وجوه شاشة «تكبير» (لو فيه أكتر من صورة). الصباع لليمين = التالية
 * زي السهم الشمال، من غير حركة انزلاق. الأسهم والصور الصغيرة و«تكبير» والإغلاق وEscape زي ما هم.
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
  const hasMany = swipeEnabled(count)
  const canZoom = Boolean(active?.src)

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => (current + delta + count) % count)
    },
    [count],
  )

  const onSwipe = useCallback((command: SwipeCommand) => go(command === 'next' ? 1 : -1), [go])
  const pageSwipe = useGallerySwipe(hasMany && !zoomed, shots, onSwipe)
  const zoomSwipe = useGallerySwipe(hasMany && zoomed, shots, onSwipe)

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
      <div
        ref={pageSwipe.surfaceRef}
        {...pageSwipe.surfaceProps}
        onClickCapture={pageSwipe.onClickCapture}
        className={cn('relative mx-auto w-full max-w-[560px]', hasMany && SWIPE_SURFACE)}
      >
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
          onClickCapture={zoomSwipe.onClickCapture}
          onClick={() => setZoomed(false)}
        >
          <div
            ref={zoomSwipe.surfaceRef}
            {...zoomSwipe.surfaceProps}
            className={cn('relative w-full max-w-2xl', hasMany && SWIPE_SURFACE)}
            onClick={(event) => event.stopPropagation()}
          >
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
