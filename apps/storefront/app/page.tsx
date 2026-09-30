import { Ruler, ShieldCheck, Truck } from 'lucide-react'
import { Faq } from '../components/store/Faq'
import { MaterialsStrip } from '../components/store/MaterialsStrip'
import { ProductCard } from '../components/store/ProductCard'
import { Container } from '../components/ui/Container'
import { getStorefrontData } from '../lib/data/source'

// الهيدر والفوتر بقوا في app/layout.tsx.
// StoreHeader و WhatsAppFab و CartBar وقف استخدامهم هنا — الحذف في كوميت تنظيف منفصل.

const STEPS = [
  { icon: Ruler, title: 'اختار النوع والمقاس', note: 'بمقاس الشباك أو بالمتر' },
  { icon: Truck, title: 'اطلب في دقيقة', note: 'أربع خانات بس' },
  { icon: ShieldCheck, title: 'ادفع عند الاستلام', note: 'تشوف الشحنة الأول' },
]

export default async function HomePage() {
  const { products, settings } = await getStorefrontData()

  return (
    <Container size="narrow" className="space-y-8 pb-16 pt-8">
      <section className="space-y-3">
        {settings.offerText ? (
          <span className="inline-block rounded bg-gold/15 px-3 py-1 text-xs font-bold text-fg">
            {settings.offerText}
          </span>
        ) : null}
        <h1 className="text-display font-extrabold leading-snug text-fg">
          أفلام حماية الزجاج — <span className="text-brand">بالمتر</span>، وإنت في البيت
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          عزل حرارة، خصوصية، وتعتيم. أدوات التركيب مرفقة، والدفع عند الاستلام لكل محافظات مصر.
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
            <li key={step.title} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
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
    </Container>
  )
}
