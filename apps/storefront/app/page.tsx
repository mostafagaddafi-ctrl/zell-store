import { Fragment } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { isListed, pickHomeProducts } from '@zell/core'
import { Faq } from '../components/store/Faq'
import { Hero } from '../components/store/Hero'
import { HowItWorks } from '../components/store/HowItWorks'
import { CollectionNav } from '../components/store/CollectionNav'
import { CollectionStrip } from '../components/store/CollectionStrip'
import { ProductCard } from '../components/store/ProductCard'
import { Container } from '../components/ui/Container'
import { getStorefrontData } from '../lib/data/source'
import { homeMobileView } from '../lib/home/homeLayout'
import { isHomeHelpSectionShown } from '../lib/nav/storeNav'

/**
 * الرئيسية — الأجزاء وترتيبها وظهورها ونصوصها من «المحتوى» في اللوحة.
 *
 * شريط «تسوّق حسب القسم» (CollectionNav) تحت الواجهة على طول — حتى لو
 * الواجهة مخفية — عشان الزائر يعرف من أول ثانية إن فيه أقسام تانية.
 *
 * أقسام الرئيسية (CollectionStrip) بتيجي مكان جزء المنتجات بعده على طول،
 * حتى لو الجزء نفسه مخفي — الأقسام ليها مفتاحها الخاص في صفحة الأقسام.
 * «إزاي أطلب» و«أسئلة متكررة» بيستخبوا لوحدهم لو قايمتهم فاضية — الشرط في `lib/nav/storeNav.ts` (STORE-MENU §٥)،
 * وهو نفسه شرط روابطهم في قائمة الموبايل.
 *
 * HOME-MOBILE (docs/contracts/HOME-MOBILE.md §٣): في compact شريط الأقسام للموبايل برّه اللوب تحت الهيدر على طول
 * (sm:hidden، من غير عنوان)، والنسخة اللي في اللوب hidden sm:block — نسخة واحدة ظاهرة في أي مقاس، ومهما الترتيب.
 * في full كل حاجة زي قبل العقد بالحرف.
 */
export default async function HomePage() {
  const { products, settings, collections } = await getStorefrontData()
  const { content } = settings
  const homeCollections = collections.filter((collection) => collection.showOnHome)
  // «الصفحة الرئيسية» في صفحة الأقسام: كل المنتجات · منتجات مختارة · ولا حاجة
  // 0016 — الإضافات (مش ظاهرة في القوايم) مابتظهرش في الرئيسية
  const listed = products.filter(isListed)
  const homeProducts = pickHomeProducts(listed, settings.homeProducts)
  const allLabel = settings.homeProducts.allLabel || 'كل المنتجات'
  const view = homeMobileView(content.heroMobileLayout)

  return (
    <Container className="pb-8">
      {view.mobileTopNav ? <CollectionNav collections={collections} className={view.mobileTopNavClassName} /> : null}
      {content.homeSections.map((section) => {
        if (section.key === 'hero') {
          return (
            <Fragment key="hero">
              {section.visible ? <Hero image={settings.heroImage} hero={content.hero} layout={content.heroMobileLayout} /> : null}
              <CollectionNav collections={collections} title="تسوّق حسب القسم" className={view.loopNavClassName} />
            </Fragment>
          )
        }

        if (section.key === 'products') {
          return (
            <div key="products" id="products" className="scroll-mt-20">
              {section.visible && homeProducts.length > 0 ? (
                <section className={view.productsClassName}>
                  <h2 className="text-xl font-bold text-fg md:text-2xl">{section.title}</h2>
                  {section.subtitle ? <p className="mt-1 text-sm text-muted">{section.subtitle}</p> : null}

                  <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
                    {homeProducts.map((product) => (
                      <ProductCard key={product.id} product={product} />
                    ))}
                  </div>

                  {homeProducts.length < listed.length ? (
                    <div className="mt-6 flex justify-center">
                      <Link
                        href="/products"
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-3 text-sm font-semibold text-fg transition-colors hover:border-brand hover:text-brand"
                      >
                        {'شوف ' + allLabel}
                        <ArrowLeft className="h-4 w-4" />
                      </Link>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {homeCollections.map((collection) => (
                <CollectionStrip key={collection.slug} collection={collection} products={products} />
              ))}
            </div>
          )
        }

        if (section.key === 'how_it_works') {
          return isHomeHelpSectionShown(section, content) ? (
            <div key="how" id="how" className="scroll-mt-20">
              <HowItWorks title={section.title} steps={content.orderSteps} />
            </div>
          ) : null
        }

        return isHomeHelpSectionShown(section, content) ? (
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
