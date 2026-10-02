import { Fragment } from 'react'
import { Faq } from '../components/store/Faq'
import { Hero } from '../components/store/Hero'
import { HowItWorks } from '../components/store/HowItWorks'
import { CollectionStrip } from '../components/store/CollectionStrip'
import { ProductCard } from '../components/store/ProductCard'
import { Container } from '../components/ui/Container'
import { getStorefrontData } from '../lib/data/source'

/**
 * الرئيسية — الأجزاء وترتيبها وظهورها ونصوصها من «المحتوى» في اللوحة.
 *
 * أقسام الرئيسية (CollectionStrip) بتيجي مكان جزء المنتجات بعده على طول،
 * حتى لو الجزء نفسه مخفي — الأقسام ليها مفتاحها الخاص في صفحة الأقسام.
 * «إزاي أطلب» و«أسئلة متكررة» بيستخبوا لوحدهم لو قايمتهم فاضية.
 */
export default async function HomePage() {
  const { products, settings, collections } = await getStorefrontData()
  const { content } = settings
  const homeCollections = collections.filter((collection) => collection.showOnHome)

  return (
    <Container className="pb-8">
      {content.homeSections.map((section) => {
        if (section.key === 'hero') {
          return section.visible ? <Hero key="hero" image={settings.heroImage} hero={content.hero} /> : null
        }

        if (section.key === 'products') {
          return (
            <Fragment key="products">
              {section.visible ? (
                <section id="products" className="scroll-mt-20 py-10 md:py-14">
                  <h2 className="text-xl font-bold text-fg md:text-2xl">{section.title}</h2>
                  {section.subtitle ? <p className="mt-1 text-sm text-muted">{section.subtitle}</p> : null}

                  <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
                    {products.map((product) => (
                      <ProductCard key={product.id} product={product} />
                    ))}
                  </div>
                </section>
              ) : null}

              {homeCollections.map((collection) => (
                <CollectionStrip key={collection.slug} collection={collection} products={products} />
              ))}
            </Fragment>
          )
        }

        if (section.key === 'how_it_works') {
          return section.visible && content.orderSteps.length > 0 ? (
            <div key="how" id="how" className="scroll-mt-20">
              <HowItWorks title={section.title} steps={content.orderSteps} />
            </div>
          ) : null
        }

        return section.visible && content.faqs.length > 0 ? (
          <section key="faq" id="faq" className="scroll-mt-20 py-10 md:py-14">
            <h2 className="text-xl font-bold text-fg md:text-2xl">{section.title}</h2>
            {section.subtitle ? <p className="mt-1 text-sm text-muted">{section.subtitle}</p> : null}
            <div className="mt-5">
              <Faq items={content.faqs} />
            </div>
          </section>
        ) : null
      })}
    </Container>
  )
}
