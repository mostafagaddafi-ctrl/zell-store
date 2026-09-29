import { useState } from 'react'
import { productPhotos } from '../../lib/core/productPhotos'
import type { StoreProduct } from '../../lib/core/types'
import { ProductArt } from './ProductArt'

/**
 * ألبوم صور المنتج: سحب بالإصبع بين الصور، وآخر شريحة «قبل وبعد» لو متوفرة.
 * لو مفيش صور خالص بيرجع للرسمة التوضيحية — الصفحة عمرها ما تبان فاضية.
 */
export function ProductGallery({
  product,
  index,
  onPhotoClick,
}: {
  product: StoreProduct
  index: number
  onPhotoClick?: (photoIndex: number) => void
}) {
  const [active, setActive] = useState(0)

  const photos = productPhotos(product)
  const hasCompare = Boolean(product.before_image && product.after_image)
  const slidesCount = (photos.length || 1) + (hasCompare ? 1 : 0)

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    const width = el.clientWidth || 1
    setActive(Math.round(Math.abs(el.scrollLeft) / width))
  }

  return (
    <div className="relative">
      <div
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.length === 0 ? (
          <div className="w-full shrink-0 snap-center">
            <ProductArt
              src={null}
              alt={product.name_ar}
              nameEn={product.name_en}
              seed={index}
              className="h-44 w-full"
            />
          </div>
        ) : (
          photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={onPhotoClick ? () => onPhotoClick(i) : undefined}
              className="w-full shrink-0 snap-center"
              aria-label={onPhotoClick ? `كبّر صورة ${product.name_ar}` : undefined}
              tabIndex={onPhotoClick ? 0 : -1}
            >
              <img
                src={url}
                alt={product.name_ar}
                loading={i === 0 ? 'eager' : 'lazy'}
                className="h-44 w-full object-cover"
              />
            </button>
          ))
        )}

        {hasCompare ? (
          <div className="flex h-44 w-full shrink-0 snap-center">
            <CompareHalf src={product.before_image as string} label="قبل" alt={product.name_ar} />
            <CompareHalf src={product.after_image as string} label="بعد" alt={product.name_ar} highlight />
          </div>
        ) : null}
      </div>

      {slidesCount > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {Array.from({ length: slidesCount }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === active ? 'w-4 bg-white' : 'w-1.5 bg-white/60'
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CompareHalf({
  src,
  label,
  alt,
  highlight = false,
}: {
  src: string
  label: string
  alt: string
  highlight?: boolean
}) {
  return (
    <div className="relative h-full w-1/2">
      <img src={src} alt={`${alt} — ${label}`} loading="lazy" className="h-full w-full object-cover" />
      <span
        className={`absolute bottom-2 ${highlight ? 'left-2' : 'right-2'} rounded-full px-2 py-0.5 text-[11px] font-bold ${
          highlight ? 'bg-[#12304f] text-white' : 'bg-black/70 text-white'
        }`}
      >
        {label}
      </span>
    </div>
  )
}
