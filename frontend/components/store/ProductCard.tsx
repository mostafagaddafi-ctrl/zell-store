import { ChevronLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { formatPiastres } from '../../lib/core/pricing'
import type { StoreProduct } from '../../lib/core/types'
import { Button } from '../../lib/shadcn/button'
import { ProductGallery } from './ProductGallery'

/** كارت بسيط: ألبوم صور (الضغط عليه يفتح صفحة المنتج)، اسم، سعر، وزرار طلب سريع. */
export function ProductCard({
  product,
  index,
  onChoose,
}: {
  product: StoreProduct
  index: number
  onChoose: (product: StoreProduct) => void
}) {
  const navigate = useNavigate()

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative">
        <ProductGallery
          product={product}
          index={index}
          onPhotoClick={() => navigate(`/product/${product.id}`)}
        />
        {product.brand ? (
          <span
            dir="ltr"
            className="pointer-events-none absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-[#12304f] shadow-retool-sm"
          >
            {product.brand}
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <Link to={`/product/${product.id}`} className="block">
          <h3 className="text-lg font-bold leading-7 text-card-foreground hover:underline">{product.name_ar}</h3>
          {product.description_ar ? (
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{product.description_ar}</p>
          ) : null}
        </Link>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-base font-extrabold text-foreground">
            {formatPiastres(product.price_per_meter_piastres)}
            <span className="text-sm font-normal text-muted-foreground"> / المتر</span>
          </span>
          <Button onClick={() => onChoose(product)} className="h-12 rounded-xl px-5 text-base font-bold">
            اختار ده
            <ChevronLeft className="mr-1 h-4 w-4" />
          </Button>
        </div>

        <Link
          to={`/product/${product.id}`}
          className="mt-2 block text-center text-xs text-primary underline-offset-4 hover:underline"
        >
          كل التفاصيل والصور
        </Link>
      </div>
    </article>
  )
}
