import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PageHeader } from '../../../components/shell/PageHeader'
import { ProductEditor } from '../../../components/products/ProductEditor'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'

export const metadata: Metadata = { title: 'منتج جديد' }

export default function NewProductPage() {
  return (
    <>
      <Link href="/products" className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-accent">
        <ArrowRight className="h-3.5 w-3.5" />
        المنتجات
      </Link>

      <PageHeader title="منتج جديد" />

      <div className="mb-4">
        <PreviewNotice what="إنشاء منتج" />
      </div>

      <ProductEditor product={null} />
    </>
  )
}
