import Link from 'next/link'
import { formatPiastres, primaryImage, type StoreProduct } from '@zell/core'
import { shortBenefit } from '../../lib/productCopy'
import { buttonClasses } from '../ui/Button'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'

/**
 * كارت بسيط: صورة، اسم، فائدة واحدة، سعر، زر واحد.
 * الصورة هي الرئيسية (preview) — مشهد الشباك، فبتتعرض بـ cover.
 */
export function ProductCard({ product }: { product: StoreProduct }) {
  const preview = primaryImage(product)

  return (
    <Link
      href={'/product/' + String(product.id)}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card transition-shadow hover:shadow-md"
    >
      <ImageSlot
        ratio="1/1"
        fit="cover"
        src={preview?.url ?? null}
        alt={preview?.alt ?? product.name_ar}
        sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 100vw"
        label="صورة المنتج"
        className="rounded-none"
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-fg">{product.name_ar}</h3>
          <p className="text-sm leading-relaxed text-muted">{shortBenefit(product)}</p>
        </div>

        <div className="mt-auto space-y-3">
          <div>
            <p className="inline-block border-b-2 border-gold pb-0.5 text-lg font-extrabold text-fg">
              <Num>{formatPiastres(product.price_per_meter_piastres)}</Num>
            </p>
            <span className="ms-1.5 text-xs text-muted">للمتر</span>
          </div>

          <span className={buttonClasses('primary', 'md', 'w-full')}>شوف التفاصيل واختار المقاس</span>
        </div>
      </div>
    </Link>
  )
}
