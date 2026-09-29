import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

/** عارض صور بملء الشاشة: يفتح بالضغط على أي صورة، وينتقل بينها. */
export function ImageLightbox({
  photos,
  startIndex,
  open,
  onClose,
  alt,
}: {
  photos: string[]
  startIndex: number
  open: boolean
  onClose: () => void
  alt: string
}) {
  const [index, setIndex] = useState(startIndex)

  useEffect(() => {
    if (open) setIndex(startIndex)
  }, [open, startIndex])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') setIndex((i) => (i + 1) % photos.length)
      if (event.key === 'ArrowRight') setIndex((i) => (i - 1 + photos.length) % photos.length)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose, photos.length])

  if (!open || photos.length === 0) return null

  const current = photos[index] ?? photos[0] ?? ''

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[60] flex flex-col bg-black/95"
      onClick={onClose}
    >
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm">
          {index + 1} / {photos.length}
        </span>
        <button
          type="button"
          aria-label="إغلاق"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-2 pb-4" onClick={(e) => e.stopPropagation()}>
        <img src={current} alt={alt} className="max-h-full max-w-full rounded-lg object-contain" />
      </div>

      {photos.length > 1 ? (
        <div
          className="flex items-center justify-center gap-6 pb-6 text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="السابق"
            onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <button
            type="button"
            aria-label="التالي"
            onClick={() => setIndex((i) => (i + 1) % photos.length)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
