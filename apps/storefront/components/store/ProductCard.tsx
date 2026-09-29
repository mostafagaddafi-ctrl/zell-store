import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { formatLength, formatPiastres, type StoreProduct } from '@zell/core'
import { FilmArt, variantForProduct } from './FilmArt'
import { Num } from './Num'

export function ProductCard({ product }: { product: StoreProduct }) {
  const variant = variantForProduct(product.name_ar, product.name_en)

  return (
    <Link
      href={'/product/' + String(product.id)}
      className="block overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-brand/50"
    >
      <FilmArt variant={variant} className="aspect-[4/3] w-full rounded-none border-0 border-b border-border" />

      <div className="space-y-2 p-4">
        <h3 className="text-base font-bold text-fg">{product.name_ar}</h3>
        {product.description_ar ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted">{product.description_ar}</p>
        ) : null}

        <div className="flex items-end justify-between gap-2 pt-1">
          <div>
            <p className="text-lg font-extrabold text-brand">
              <Num>{formatPiastres(product.price_per_meter_piastres)}</Num>
            </p>
            <p className="text-xs text-muted">
              للمتر · أقل طلب <Num>{formatLength(product.min_length_cm)}</Num>
            </p>
          </div>
          <span className="flex items-center gap-1 text-sm font-semibold text-brand">
            اختار المقاس
            <ArrowLeft className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}
