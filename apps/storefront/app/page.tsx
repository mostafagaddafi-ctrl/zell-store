import { Ruler, ShieldCheck, Truck } from 'lucide-react'
import { CartBar } from '../components/store/CartBar'
import { Faq } from '../components/store/Faq'
import { MaterialsStrip } from '../components/store/MaterialsStrip'
import { ProductCard } from '../components/store/ProductCard'
import { StoreHeader } from '../components/store/StoreHeader'
import { WhatsAppFab } from '../components/store/WhatsAppFab'
import { getStorefrontData } from '../lib/data/source'

const STEPS = [
  { icon: Ruler, title: 'اختار النوع والمقاس', note: 'بمقاس الشباك أو بالمتر' },
  { icon: Truck, title: 'اطلب في دقيقة', note: 'أربع خانات بس' },
  { icon: ShieldCheck, title: 'ادفع عند الاستلام', note: 'تشوف الشحنة الأول' },
]

export default async function HomePage() {
  const { products, settings } = await getStorefrontData()

  return (
    <>
      <StoreHeader storeName={settings.storeName} />

      <main className="mx-auto max-w-app space-y-8 px-4 pb-32 pt-6">
        <section className="space-y-3">
          {settings.offerText ? (
            <span className="inline-block rounded-full bg-gold/15 px-3 py-1 text-xs font-bold text-fg">
              {settings.offerText}
            </span>
          ) : null}
          <h1 className="text-2xl font-extrabold leading-snug text-fg">
            أفلام حماية الزجاج — <span className="text-brand">بالمتر</span>، وإنت في البيت
          </h1>
          <p className="text-sm leading-relaxed text-muted">
            عزل حرارة، خصوصية، وتعتيم. خامات 3M و V-KOOL، أدوات التركيب مرفقة، والدفع عند الاستلام
            لكل محافظات مصر.
          </p>
        </section>

        <MaterialsStrip />

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-fg">اختار نوع الفيلم</h2>
          <div className="grid grid-cols-1 gap-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-fg">الطلب بيتم إزاي</h2>
          <ol className="space-y-2">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-fg">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{step.title}</p>
                  <p className="text-xs text-muted">{step.note}</p>
                </div>
                <step.icon className="ms-auto h-5 w-5 shrink-0 text-muted" />
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-fg">أسئلة متكررة</h2>
          <Faq />
        </section>
      </main>

      {/* واتساب للاستفسار بس — مش مسار طلب */}
      <WhatsAppFab number={settings.whatsappNumber} message={settings.whatsappMessage} />
      <CartBar />
    </>
  )
}
