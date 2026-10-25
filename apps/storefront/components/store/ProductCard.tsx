import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import {
  discountInfo,
  formatPiastres,
  lowestPricePerMeter,
  primaryImage,
  isPiece,
  widthOptionsOf,
  type StoreProduct,
} from '@zell/core'
import { cn } from '../../lib/cn'
import { shortBenefit } from '../../lib/productCopy'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'

/**
 * كارت بسيط: صورة، اسم، فائدة واحدة، سعر، زر واحد.
 * الصورة هي الرئيسية (preview) — مشهد الشباك، فبتتعرض بـ cover.
 */
/**
 * density (0017): regular = الكارت العادي بنفس كلاساته بالحرف في كل مكان.
 * compact = لشبكة صفحة القسم المدمجة (٣–٤ أعمدة): من غير الفائدة المختصرة
 * ومن غير «واختيار المقاس»، ومقاسات أصغر، وصورة أصغر.
 *
 * ⚠️ الكارت كله لينك واحد بس — ممنوع أي لينك أو زرار أو onClick جواه.
 *    «التفاصيل» span متنسّق زي زرار، مش عنصر تفاعلي.
 */
/** HOME-MOBILE §٦ — «التفاصيل» خفيف (span مش زرار: الكارت لينك واحد). compact = نفس الستايل بـ h-9. */
const DETAILS_CLASSES =
  'inline-flex h-10 w-full items-center justify-center gap-1 rounded-lg border border-brand/20 bg-brand/[0.04] px-2 text-xs font-bold text-brand transition-colors group-hover:bg-brand group-hover:text-brand-fg sm:text-sm'

/**
 * headingLevel: مستوى عنوان الكارت. 3 (الافتراضي) تحت عنوان h2 زي أقسام الرئيسية؛ 2 في الصفحات اللي الكروت فيها
 * تحت الـ h1 على طول (صفحة القسم و«كل المنتجات»)، عشان ترتيب العناوين مايقفزش (Lighthouse heading-order). الشكل زي ما هو.
 */
export function ProductCard({ product, density = 'regular', headingLevel = 3 }: { product: StoreProduct; density?: 'regular' | 'compact'; headingLevel?: 2 | 3 }) {
  const compact = density === 'compact'
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const preview = primaryImage(product)
  const multi = widthOptionsOf(product).length > 1
  const discount = multi ? null : discountInfo(product)
  const shownPrice = multi ? lowestPricePerMeter(product) : product.price_per_meter_piastres

  return (
    <Link
      href={'/product/' + String(product.id)}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <div className="relative">
      <ImageSlot
        ratio="1/1"
        fit="cover"
        src={preview?.url ?? null}
        alt={preview?.alt ?? product.name_ar}
        sizes={compact ? '(min-width: 1024px) 260px, (min-width: 640px) 31vw, 48vw' : '(min-width: 1024px) 380px, (min-width: 640px) 45vw, 46vw'}
        label="صورة المنتج"
        className="rounded-none"
      />
        {discount ? (
          <span className={compact ? 'absolute start-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-brand-fg shadow-card' : 'absolute start-2 top-2 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-brand-fg shadow-card'}>
            خصم <Num>{String(discount.percent)}</Num>٪
          </span>
        ) : null}
      </div>

      <div className={compact ? 'flex flex-1 flex-col gap-2 p-2.5 sm:p-3' : 'flex flex-1 flex-col gap-2.5 p-3 sm:gap-3 sm:p-4'}>
        <div className="space-y-1">
          <Heading className={compact ? 'line-clamp-2 min-h-10 text-sm font-bold leading-5 text-fg' : 'line-clamp-2 min-h-10 text-sm font-bold leading-5 text-fg sm:min-h-0 sm:text-base'}>{product.name_ar}</Heading>
          {compact ? null : <p className="hidden text-sm leading-relaxed text-muted sm:block">{shortBenefit(product)}</p>}
        </div>

        <div className={compact ? 'mt-auto space-y-2' : 'mt-auto space-y-3'}>
          <div>
            {multi ? <span className="me-1 text-xs text-muted">من</span> : null}
            <p className={compact ? 'inline-block border-b-2 border-gold pb-0.5 text-base font-extrabold text-fg' : 'inline-block border-b-2 border-gold pb-0.5 text-lg font-extrabold text-fg sm:text-xl'}>
              <Num>{formatPiastres(shownPrice)}</Num>
            </p>
            {discount ? (
              <span className={compact ? 'ms-1 text-xs text-muted line-through' : 'ms-1.5 text-sm text-muted line-through'}>
                <Num>{formatPiastres(discount.compareAtPiastres)}</Num>
              </span>
            ) : null}
            <span className={compact ? 'ms-1 text-[11px] text-muted' : 'ms-1.5 text-xs text-muted'}>{isPiece(product) ? 'للوحدة' : 'للمتر'}</span>
          </div>

          {compact ? (
            <span className={cn(DETAILS_CLASSES, 'h-9')}>
              التفاصيل
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : (
            <span className={DETAILS_CLASSES}>
              التفاصيل{' '}
              {isPiece(product) ? null : <span className="hidden sm:inline">واختيار المقاس</span>}
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
