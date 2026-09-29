import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { BeforeAfter } from '../components/store/BeforeAfter'
import { BrandHero } from '../components/store/BrandHero'
import { CartSheet, type CartEntry, type CheckoutValues } from '../components/store/CartSheet'
import { Faq } from '../components/store/Faq'
import { MaterialsStrip } from '../components/store/MaterialsStrip'
import { ProductCard } from '../components/store/ProductCard'
import { SizeSheet } from '../components/store/SizeSheet'
import { StoreHeader } from '../components/store/StoreHeader'
import { Testimonials } from '../components/store/Testimonials'
import { WhatsAppFab } from '../components/store/WhatsAppFab'
import { useCart } from '../hooks/useCart'
import { useCreateOrder, useGetStorefront } from '../hooks/backend/storefront'
import { computeShippingPiastres, computeSubtotalPiastres, formatPiastres } from '../lib/core/pricing'
import type { CreatedOrder, CreateOrderResult, StorefrontData, StoreProduct } from '../lib/core/types'
import { Button } from '../lib/shadcn/button'
import { Toaster, toast } from '../lib/shadcn/sonner'

const EMPTY_CHECKOUT: CheckoutValues = {
  customerName: '',
  customerPhone: '',
  governorate: '',
  address: '',
  notes: '',
}

export default function Store() {
  const storefront = useGetStorefront()
  const createOrder = useCreateOrder()
  const cart = useCart()

  const [cartOpen, setCartOpen] = useState(false)
  const [sizeProduct, setSizeProduct] = useState<StoreProduct | null>(null)
  const [checkout, setCheckout] = useState<CheckoutValues>(EMPTY_CHECKOUT)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null)
  const productsRef = useRef<HTMLDivElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // رجوع من صفحة المنتج بـ ?cart=1 يفتح السلة على طول
  useEffect(() => {
    if (searchParams.get('cart') === '1') {
      setCartOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const scrollToProducts = () => {
    productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    storefront.trigger()
  }, [storefront.trigger])

  const data = storefront.data as StorefrontData | null
  const products = useMemo(() => data?.products ?? [], [data])

  // لو منتج اتشال أو اتقفل، نشيله من السلة المحفوظة
  useEffect(() => {
    if (!data) return
    const ids = new Set(products.map((p) => p.id))
    for (const line of cart.lines) {
      if (!ids.has(line.productId)) cart.removeByProduct(line.productId)
    }
  }, [data, products, cart.lines, cart.removeByProduct])

  const entries: CartEntry[] = useMemo(() => {
    const out: CartEntry[] = []
    for (const line of cart.lines) {
      const index = products.findIndex((p) => p.id === line.productId)
      const product = products[index]
      if (product) out.push({ lineId: line.id, product, lengthCm: line.lengthCm, index })
    }
    return out
  }, [cart.lines, products])

  const subtotalPiastres = entries.reduce(
    (sum, entry) => sum + computeSubtotalPiastres(entry.product.price_per_meter_piastres, entry.lengthCm),
    0,
  )

  const shippingPiastres = data
    ? computeShippingPiastres(
        checkout.governorate,
        subtotalPiastres,
        data.shippingRates,
        data.shippingDefaultPiastres,
        data.freeShippingThresholdPiastres,
      )
    : 0

  const whatsappHref = data?.whatsappNumber
    ? `https://wa.me/${data.whatsappNumber}?text=${encodeURIComponent(data.whatsappMessage || '')}`
    : null

  const handleConfirmSize = (productId: number, lengthCm: number) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    cart.add(productId, Math.min(lengthCm, product.max_length_cm))
    setSizeProduct(null)
    toast.success('اتضاف للسلة', {
      description: product.name_ar,
      action: { label: 'إتمام الطلب', onClick: () => setCartOpen(true) },
    })
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    try {
      const result = (await createOrder.trigger({
        items: entries.map((entry) => ({ productId: entry.product.id, lengthCm: entry.lengthCm })),
        customerName: checkout.customerName.trim(),
        customerPhone: checkout.customerPhone.trim(),
        governorate: checkout.governorate,
        address: checkout.address.trim(),
        notes: checkout.notes.trim(),
      }).result) as CreateOrderResult

      if (result.ok) {
        setCreatedOrder(result.order)
        cart.clear()
        setCheckout(EMPTY_CHECKOUT)
      } else {
        setSubmitError(result.message)
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'حصل خطأ، حاول تاني')
    }
  }

  const showBar = entries.length > 0 && !createdOrder

  return (
    <div dir="rtl" className="min-h-screen bg-background pb-28">
      <StoreHeader
        storeName={data?.storeName ?? ''}
        logoUrl={data?.logoUrl ?? ''}
        cartCount={entries.length}
        onCartClick={() => setCartOpen(true)}
      />

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-4">
        <BrandHero offerText={data?.offerText ?? ''} onShopClick={scrollToProducts} />

        <section ref={productsRef} className="scroll-mt-20">
          <h2 className="text-lg font-bold text-foreground">اختار اللي يناسب بيتك</h2>

          <div className="mt-3 space-y-4">
            {storefront.loading && !data ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                جاري التحميل…
              </div>
            ) : null}

            {storefront.error ? (
              <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{storefront.error}</p>
            ) : null}

            {data && products.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                مفيش منتجات معروضة حالياً.
              </p>
            ) : null}

            {products.map((product, index) => (
              <ProductCard key={product.id} product={product} index={index} onChoose={setSizeProduct} />
            ))}
          </div>
        </section>

        <BeforeAfter items={data?.gallery ?? []} />

        <MaterialsStrip items={data?.materials ?? []} />

        <Testimonials items={data?.testimonials ?? []} />

        <Faq />

        <p className="pb-2 text-center text-xs text-muted-foreground">
          ZELL — أفلام زجاج للبيوت · الدفع عند الاستلام · توصيل لكل مصر
        </p>
      </main>

      {/* شريط ثابت تحت */}
      {showBar ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="text-sm">
              <div className="text-xs text-muted-foreground">{entries.length} صنف · من غير الشحن</div>
              <div className="font-bold">{formatPiastres(subtotalPiastres)}</div>
            </div>
            <Button onClick={() => setCartOpen(true)} className="h-12 flex-1 rounded-xl text-base font-bold">
              إتمام الطلب
            </Button>
          </div>
        </div>
      ) : null}

      <SizeSheet
        product={sizeProduct}
        open={sizeProduct !== null}
        onOpenChange={(open) => {
          if (!open) setSizeProduct(null)
        }}
        onConfirm={handleConfirmSize}
      />

      <CartSheet
        open={cartOpen}
        onOpenChange={(open) => {
          setCartOpen(open)
          if (!open && createdOrder) setCreatedOrder(null)
        }}
        entries={entries}
        governorates={data?.governorates ?? []}
        shippingPiastres={shippingPiastres}
        subtotalPiastres={subtotalPiastres}
        values={checkout}
        onValuesChange={setCheckout}
        onLengthChange={cart.setLength}
        onRemove={cart.remove}
        onSubmit={handleSubmit}
        submitting={createOrder.loading}
        errorMessage={submitError}
        createdOrder={createdOrder}
        whatsappHref={whatsappHref}
        onNewOrder={() => {
          setCreatedOrder(null)
          setCartOpen(false)
        }}
        onContinueShopping={() => {
          setCartOpen(false)
          scrollToProducts()
        }}
      />

      {whatsappHref && !cartOpen && sizeProduct === null ? (
        <WhatsAppFab href={whatsappHref} raised={showBar} />
      ) : null}

      <Toaster position="bottom-center" dir="rtl" />
    </div>
  )
}
