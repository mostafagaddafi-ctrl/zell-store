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

      {/* التنبيه فوق قبل الفورم — مش في شريط الحفظ تحت بس */}
      <div className="mb-4">
        <PreviewNotice
          what="إنشاء منتج"
          note="مش هيتعمل أي منتج جديد، ومش هيتسجّل أي صف في قاعدة البيانات. الشاشة دي لمراجعة الشكل بس."
        />
      </div>

      <PageHeader title="منتج جديد" />

      <ProductEditor product={null} />
    </>
  )
}
