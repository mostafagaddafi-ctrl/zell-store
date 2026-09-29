import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { formatLength, formatPiastres } from '@zell/core'
import { FilmArt, variantForProduct } from '../../../components/store/FilmArt'
import { Num } from '../../../components/store/Num'
import { ProductBuy } from '../../../components/store/ProductBuy'
import { StoreHeader } from '../../../components/store/StoreHeader'
import { getFallbackProductById, getFallbackProducts, getFallbackSettings } from '../../../lib/catalog'

type PageProps = { params: Promise<{ productId: string }> }

export function generateStaticParams() {
  return getFallbackProducts().map((product) => ({ productId: String(product.id) }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { productId } = await params
  const product = getFallbackProductById(Number(productId))
  if (!product) return { title: 'المنتج مش موجود' }
  return {
    title: product.name_ar,
    description: product.description_ar ?? undefined,
  }
}

export default async function ProductPage({ params }: PageProps) {
  const { productId } = await params
  const product = getFallbackProductById(Number(productId))
  if (!product) notFound()

  const settings = getFallbackSettings()
  const variant = variantForProduct(product.name_ar, product.name_en)

  return (
    <>
      <StoreHeader storeName={settings.storeName} />

      <main className="mx-auto max-w-app space-y-5 px-4 pb-40 pt-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
          <ArrowRight className="h-4 w-4" />
          كل الأنواع
        </Link>

        <FilmArt variant={variant} className="aspect-[4/3] w-full" />

        <div className="space-y-2">
          <h1 className="text-xl font-extrabold text-fg">{product.name_ar}</h1>
          {product.name_en ? <p className="text-xs text-muted">{product.name_en}</p> : null}
          {product.description_ar ? (
            <p className="text-sm leading-relaxed text-muted">{product.description_ar}</p>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <Spec label="سعر المتر" value={formatPiastres(product.price_per_meter_piastres)} />
          <Spec label="عرض الرول" value={String(product.width_cm) + ' سم'} />
          <Spec label="أقل طلب" value={formatLength(product.min_length_cm)} />
          <Spec label="الزيادة بخطوة" value={formatLength(product.step_cm)} />
        </dl>

        <ProductBuy product={product} />
      </main>
    </>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold text-fg">
        <Num>{value}</Num>
      </dd>
    </div>
  )
}
