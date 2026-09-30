import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CheckoutForm } from '../../components/store/CheckoutForm'
import { Container } from '../../components/ui/Container'
import { getStorefrontData } from '../../lib/data/source'

export const metadata: Metadata = { title: 'بيانات التوصيل' }

export default async function CheckoutPage() {
  const { products, settings } = await getStorefrontData()

  return (
    <Container className="py-8 md:py-12">
      <Link href="/cart" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
        <ArrowRight className="h-4 w-4" />
        رجوع للسلة
      </Link>

      <h1 className="mt-4 text-xl font-extrabold text-fg md:text-2xl">بيانات التوصيل</h1>

      <div className="mt-6">
        <CheckoutForm products={products} settings={settings} />
      </div>
    </Container>
  )
}
