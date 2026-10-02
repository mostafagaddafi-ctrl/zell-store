import { Faq } from '../components/store/Faq'
import { Hero } from '../components/store/Hero'
import { HowItWorks } from '../components/store/HowItWorks'
import { CollectionStrip } from '../components/store/CollectionStrip'
import { ProductCard } from '../components/store/ProductCard'
import { Container } from '../components/ui/Container'
import { getStorefrontData } from '../lib/data/source'

// MaterialsStrip وقف استخدامه هنا — الحذف في كوميت تنظيف منفصل.

export default async function HomePage() {
  const { products, settings, collections } = await getStorefrontData()

  return (
    <Container className="pb-8">
      <Hero offerText={settings.offerText} image={settings.heroImage} />

      <section id="products" className="scroll-mt-20 py-10 md:py-14">
        <h2 className="text-xl font-bold text-fg md:text-2xl">اختار نوع الفيلم</h2>
        <p className="mt-1 text-sm text-muted">ثلاث خامات، والسعر بالمتر الطولي.</p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      {/*
        المجموعات بعد كل الأفلام: الزائر الجديد بيشوف الكتالوج كله
        الأول، وبعدين التجميعات. مجموعة فاضية أو مخفية مابتوصلش هنا
        أصلاً — التصفية في toStoreCollections.
      */}
      {collections.map((collection) => (
        <CollectionStrip key={collection.slug} collection={collection} products={products} />
      ))}

      <div id="how" className="scroll-mt-20">
        <HowItWorks />
      </div>

      <section id="faq" className="scroll-mt-20 py-10 md:py-14">
        <h2 className="text-xl font-bold text-fg md:text-2xl">أسئلة متكررة</h2>
        <div className="mt-5">
          <Faq />
        </div>
      </section>
    </Container>
  )
}
