import Link from 'next/link'
import {
  discountInfo,
  formatPiastres,
  lowestPricePerMeter,
  primaryImage,
  widthOptionsOf,
  type StoreProduct,
} from '@zell/core'
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
  const multi = widthOptionsOf(product).length > 1
  const discount = multi ? null : discountInfo(product)
  const shownPrice = multi ? lowestPricePerMeter(product) : product.price_per_meter_piastres

  return (
    <Link
      href={'/product/' + String(product.id)}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
    >
      <div className="relative">
      <ImageSlot
        ratio="1/1"
        fit="cover"
        src={preview?.url ?? null}
        alt={preview?.alt ?? product.name_ar}
        sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 46vw"
        label="صورة المنتج"
        className="rounded-none"
      />
        {discount ? (
          <span className="absolute start-2 top-2 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-brand-fg shadow-card">
            خصم <Num>{String(discount.percent)}</Num>٪
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3 sm:gap-3 sm:p-4">
        <div className="space-y-1">
          <h3 className="line-clamp-2 min-h-10 text-sm font-bold leading-5 text-fg sm:min-h-0 sm:text-base">{product.name_ar}</h3>
          <p className="hidden text-sm leading-relaxed text-muted sm:block">{shortBenefit(product)}</p>
        </div>

        <div className="mt-auto space-y-3">
          <div>
            {multi ? <span className="me-1 text-xs text-muted">من</span> : null}
            <p className="inline-block border-b-2 border-gold pb-0.5 text-lg font-extrabold text-fg sm:text-xl">
              <Num>{formatPiastres(shownPrice)}</Num>
            </p>
            {discount ? (
              <span className="ms-1.5 text-sm text-muted line-through">
                <Num>{formatPiastres(discount.compareAtPiastres)}</Num>
              </span>
            ) : null}
            <span className="ms-1.5 text-xs text-muted">للمتر</span>
          </div>

          <span className={buttonClasses('primary', 'md', 'w-full px-2 text-xs sm:px-4 sm:text-sm')}>التفاصيل <span className="hidden sm:inline">واختيار المقاس</span></span>
        </div>
      </div>
    </Link>
  )
}
