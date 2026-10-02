import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, Check } from 'lucide-react'
import { formatLength, formatPiastres } from '@zell/core'
import { Num } from '../../../components/store/Num'
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
  // الهدية من «نص العرض» — نفس البيانات المكاشة، مفيش طلب زيادة
  const { settings } = await getStorefrontData()
  const gift = settings.offerEnabled ? settings.offerText : ''

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
              <span className="inline-block border-b-2 border-gold pb-0.5 text-2xl font-extrabold text-fg">
                <Num>{formatPiastres(product.price_per_meter_piastres)}</Num>
              </span>
              <span className="ms-2 text-sm text-muted">للمتر الطولي</span>
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

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
              <Spec label="عرض الرول" value={String(product.width_cm) + ' سم'} />
              <Spec label="أقل طلب" value={formatLength(product.min_length_cm)} />
              <Spec label="الزيادة بخطوة" value={formatLength(product.step_cm)} />
            </dl>
          </section>

          {/* ٣ + ٤ — اختيار المقاس والإضافة للسلة */}
          <ProductBuy product={product} gift={gift} />
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
