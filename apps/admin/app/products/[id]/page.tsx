import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { PageHeader } from '../../../components/shell/PageHeader'
import { ProductEditor } from '../../../components/products/ProductEditor'
import { Badge } from '../../../components/ui/Badge'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData } from '../../../lib/adminData'
import { formatDateTime } from '../../../lib/format'

type PageProps = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const product = await adminData.getProduct(Number(id))
  return { title: product ? product.nameAr : 'منتج' }
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params
  const product = await adminData.getProduct(Number(id))
  if (!product) notFound()

  return (
    <>
      <Link href="/products" className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-accent">
        <ArrowRight className="h-3.5 w-3.5" />
        المنتجات
      </Link>

      <PageHeader
        title={product.nameAr}
        description={'آخر تعديل: ' + formatDateTime(product.updatedAt)}
        actions={product.isActive ? <Badge tone="ok">ظاهر</Badge> : <Badge tone="neutral">مخفي</Badge>}
      />

      <div className="mb-4">
        <PreviewNotice what="تعديل بيانات المنتج وأسعاره وصوره" />
      </div>

      <ProductEditor product={product} />
    </>
  )
}
