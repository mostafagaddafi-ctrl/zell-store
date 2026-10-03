import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, Check } from 'lucide-react'
import {
  discountInfo,
  formatLength,
  formatPiastres,
  isPiece,
  lowestPricePerMeter,
  widthOptionsOf,
  type StoreProduct,
} from '@zell/core'
import { Num } from '../../../components/store/Num'
import { PieceBuy } from '../../../components/store/PieceBuy'
import { ProductBuy } from '../../../components/store/ProductBuy'
import { ProductGallery } from '../../../components/store/ProductGallery'
import { Container } from '../../../components/ui/Container'
import { keyPoints } from '../../../lib/productCopy'
import { getStorefrontProductById, getStorefrontData } from '../../../lib/data/source'

/**
 * مفيش generateStaticParams عن قصد.
 *
 * كانت بتقرا من الداتابيز **وقت البناء**، فأي خلل في مفتاح أو شبكة كان
 * بيفشّل النشر كله. من غيرها الصفحة بتتولّد عند أول طلب وبتتكاش حسب
 * revalidate، وكمان أي منتج جديد بيظهر من غير إعادة نشر.
 */

type PageProps = { params: Promise<{ productId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { productId } = await params
  const product = await getStorefrontProductById(Number(productId))
  if (!product) return { title: 'المنتج مش موجود' }
  return {
    title: product.name_ar,
    description: product.description_ar ?? undefined,
  }
}

export default async function ProductPage({ params }: PageProps) {
  const { productId } = await params
  const product = await getStorefrontProductById(Number(productId))
  if (!product) notFound()

  const points = keyPoints(product)
  // 0015 — أكتر من عرض = «يبدأ من» أقل سعر، والخصم بيظهر جوه اختيار العرض
  const multi = widthOptionsOf(product).length > 1
  const discount = multi ? null : discountInfo(product)
  const shownPrice = multi ? lowestPricePerMeter(product) : product.price_per_meter_piastres
  // الهدية من «نص العرض» — نفس البيانات المكاشة، مفيش طلب زيادة
  const { settings, products: catalog } = await getStorefrontData()
  const gift = settings.offerEnabled ? settings.offerText : ''
  // 0016 — منتج القطعة: عدد بدل مقاسات. منتج المتر: إضافاته (قطع نشطة) بالترتيب.
  const piece = isPiece(product)
  const addons = (product.addon_ids ?? [])
    .map((id) => catalog.find((item) => item.id === id))
    .filter((item): item is StoreProduct => item !== undefined && isPiece(item))
  const widths = widthOptionsOf(product)

  return (
    <Container className="py-6 md:py-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
        <ArrowRight className="h-4 w-4" />
        كل الأنواع
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-12 lg:gap-12">
        {/* ١ — المعرض */}
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <ProductGallery product={product} />
          </div>
        </div>

        <div className="space-y-8 lg:col-span-7">
          {/* ٢ — معلومات المنتج */}
          <section className="space-y-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold text-fg">{product.name_ar}</h1>
              {product.name_en ? <p className="text-xs text-muted">{product.name_en}</p> : null}
            </div>

            <div>
              {multi ? <span className="me-1.5 text-sm text-muted">يبدأ من</span> : null}
              <span className="inline-block border-b-2 border-gold pb-0.5 text-2xl font-extrabold text-fg">
                <Num>{formatPiastres(shownPrice)}</Num>
              </span>
              {discount ? (
                <span className="ms-2 text-base text-muted line-through">
                  <Num>{formatPiastres(discount.compareAtPiastres)}</Num>
                </span>
              ) : null}
              <span className="ms-2 text-sm text-muted">{piece ? 'للقطعة' : 'للمتر الطولي'}</span>
              {discount ? (
                <p className="mt-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-bold text-brand-fg">
                    خصم <Num>{String(discount.percent)}</Num>٪ · وفّر <Num>{formatPiastres(discount.savePiastres)}</Num> {piece ? 'في القطعة' : 'في المتر'}
                  </span>
                </p>
              ) : null}
            </div>

            {product.description_ar ? (
              <p className="max-w-prose text-sm leading-relaxed text-muted">{product.description_ar}</p>
            ) : null}

            {points.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {points.map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm text-fg">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {point}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* المواصفات: كل عروض الرول + أقل طلب. القطعة مالهاش مقاسات. */}
            {piece ? null : (
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
                <Spec label={widths.length > 1 ? 'عروض الرول' : 'عرض الرول'} value={widths.map((option) => String(option.width_cm)).join(' / ') + ' سم'} />
                <Spec label="أقل طلب" value={formatLength(product.min_length_cm)} />
              </dl>
            )}
          </section>

          {/* ٣ + ٤ — اختيار المقاس والإضافة للسلة */}
          {piece ? (
            <PieceBuy product={product} />
          ) : (
            <ProductBuy product={product} gift={gift} addons={addons} addonsTitle={settings.addonsTitle} />
          )}
        </div>
      </div>
    </Container>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold text-fg">
        <Num>{value}</Num>
      </dd>
    </div>
  )
}
