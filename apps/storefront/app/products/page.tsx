import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { isListed } from '@zell/core'
import { CollectionNav } from '../../components/store/CollectionNav'
import { ProductCard } from '../../components/store/ProductCard'
import { Container } from '../../components/ui/Container'
import { getStorefrontData } from '../../lib/data/source'

/**
 * كل المنتجات — الرابط اللي في القائمة (اسمه من «الصفحة الرئيسية» في اللوحة).
 * الرئيسية ممكن تعرض منتجات مختارة بس، فالصفحة دي المدخل الثابت للباقي.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getStorefrontData()
  return { title: settings.homeProducts.allLabel || 'كل المنتجات' }
}

export default async function AllProductsPage() {
  const { products, settings, collections } = await getStorefrontData()
  const title = settings.homeProducts.allLabel || 'كل المنتجات'
  const listed = products.filter(isListed)

  return (
    <Container className="pb-8">
      <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-accent"
        >
          <ArrowRight className="h-4 w-4" />
          الرئيسية
        </Link>
      </nav>

      <CollectionNav collections={collections} title="تسوّق حسب القسم" />

      <header className="py-6 md:py-8">
        <h1 className="text-display font-extrabold text-fg">{title}</h1>
      </header>

      {listed.length === 0 ? (
        <p className="pb-6 text-sm text-muted">مفيش منتجات متاحة دلوقتي.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 pb-6 sm:gap-5 lg:grid-cols-3">
          {listed.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </Container>
  )
}
