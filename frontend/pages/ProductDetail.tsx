import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Loader2, ShoppingCart, Truck, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { ImageLightbox } from '../components/store/ImageLightbox'
import { ProductArt } from '../components/store/ProductArt'
import { SizePicker } from '../components/store/SizePicker'
import { useCart } from '../hooks/useCart'
import { useGetStorefront } from '../hooks/backend/storefront'
import { formatLength, formatPiastres } from '../lib/core/pricing'
import { productPhotos } from '../lib/core/productPhotos'
import type { StorefrontData } from '../lib/core/types'
import { Button } from '../lib/shadcn/button'
import { Toaster, toast } from '../lib/shadcn/sonner'

export default function ProductDetail() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const storefront = useGetStorefront()
  const cart = useCart()

  const [activePhoto, setActivePhoto] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    storefront.trigger()
  }, [storefront.trigger])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [productId])

  const data = storefront.data as StorefrontData | null
  const product = useMemo(
    () => data?.products.find((p) => String(p.id) === productId) ?? null,
    [data, productId],
  )

  const photos = product ? productPhotos(product) : []

  if (storefront.loading && !data) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center gap-2 bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        جاري التحميل…
      </div>
    )
  }

  if (!product) {
    return (
      <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <p className="text-muted-foreground">المنتج ده مش موجود أو مش متاح حالياً.</p>
        <Button asChild className="h-12 rounded-xl">
          <Link to="/">رجوع للمتجر</Link>
        </Button>
      </div>
    )
  }

  const handleAdd = (productIdToAdd: number, lengthCm: number) => {
    cart.add(productIdToAdd, Math.min(lengthCm, product.max_length_cm))
    toast.success('اتضاف للسلة', {
      description: product.name_ar,
      action: { label: 'إتمام الطلب', onClick: () => navigate('/?cart=1') },
    })
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background pb-10">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10" aria-label="رجوع">
            <Link to="/">
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
          <span className="truncate font-bold text-foreground">{product.name_ar}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4">
        {/* الصورة الكبيرة */}
        <button
          type="button"
          onClick={() => photos.length > 0 && setLightboxOpen(true)}
          className="block w-full overflow-hidden rounded-2xl border border-border"
          aria-label="كبّر الصورة"
        >
          {photos.length > 0 ? (
            <img src={photos[activePhoto]} alt={product.name_ar} className="h-64 w-full object-cover sm:h-80" />
          ) : (
            <ProductArt
              src={null}
              alt={product.name_ar}
              nameEn={product.name_en}
              seed={product.id}
              className="h-64 w-full sm:h-80"
            />
          )}
        </button>

        {photos.length > 1 ? (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {photos.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setActivePhoto(i)}
                aria-label={`صورة ${i + 1}`}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                  i === activePhoto ? 'border-primary' : 'border-transparent opacity-70'
                }`}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}

        {/* العنوان والسعر */}
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-foreground">{product.name_ar}</h1>
            {product.brand ? (
              <span dir="ltr" className="mt-1 inline-block text-xs font-extrabold text-muted-foreground">
                {product.brand}
              </span>
            ) : null}
          </div>
          <div className="shrink-0 text-left">
            <div className="text-xl font-extrabold text-foreground">
              {formatPiastres(product.price_per_meter_piastres)}
            </div>
            <div className="text-xs text-muted-foreground">للمتر الطولي</div>
          </div>
        </div>

        {product.description_ar ? (
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{product.description_ar}</p>
        ) : null}

        {/* المواصفات */}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Spec label="عرض الرول" value={`${product.width_cm} سم`} />
          <Spec label="أقل طلب" value={formatLength(product.min_length_cm)} />
          <Spec label="الزيادة بخطوة" value={formatLength(product.step_cm)} />
          <Spec label="أقصى طول" value={formatLength(product.max_length_cm)} />
        </dl>

        <ul className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
          <Perk icon={<BadgeCheck className="h-4 w-4" />} text="أدوات التركيب مجاناً" />
          <Perk icon={<Truck className="h-4 w-4" />} text="توصيل لكل مصر" />
          <Perk icon={<Wallet className="h-4 w-4" />} text="دفع عند الاستلام" />
        </ul>

        {/* اختيار المقاس */}
        <section className="mt-6 rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-card-foreground">
            <ShoppingCart className="h-4 w-4 text-primary" />
            حدد المقاس واطلب
          </h2>
          <SizePicker product={product} onConfirm={handleAdd} />
        </section>

        {/* التركيب */}
        <section className="mt-5 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold text-card-foreground">التركيب على الزجاج في 3 خطوات</h2>
          <ol className="mt-2 space-y-1.5 text-sm leading-6 text-muted-foreground">
            <li>١) قيس الشباك ونظّف الزجاج من أي تراب أو دهون.</li>
            <li>٢) رشّ الزجاج بميه ونقط صابون وحطّ الفيلم — هتقدر تحركه وتظبطه.</li>
            <li>٣) اسحب بالإسكويجي من النص للأطراف وقصّ الزيادة بالكتر.</li>
          </ol>
        </section>

        <Button asChild variant="outline" className="mt-5 h-12 w-full rounded-xl">
          <Link to="/">شوف باقي الأنواع</Link>
        </Button>
      </main>

      <ImageLightbox
        photos={photos}
        startIndex={activePhoto}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        alt={product.name_ar}
      />

      <Toaster position="bottom-center" dir="rtl" />
    </div>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-bold text-foreground">{value}</dd>
    </div>
  )
}

function Perk({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <li className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-2 text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {text}
    </li>
  )
}
