import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { ProductEditor } from '../../../../components/products/ProductEditor'
import { readProductWidths } from '../../../../lib/data/productWidths'
import { readAddonOptions, readProductAddons } from '../../../../lib/data/productAddons'
import { readAddonsTitle } from '../../../../lib/data/addonsTitle'
import { Badge } from '../../../../components/ui/Badge'
import { Card } from '../../../../components/ui/Field'
import { PreviewNotice } from '../../../../components/ui/PreviewNotice'
import { adminData } from '../../../../lib/adminData'
import { formatDateTime } from '../../../../lib/format'
import { requireAdminPage } from '../../../../lib/auth/guards'

type PageProps = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const product = await adminData.getProduct(Number(id))
  return { title: product ? product.nameAr : 'منتج' }
}

export default async function ProductPage({ params }: PageProps) {
  await requireAdminPage()

  const { id } = await params
  const product = await adminData.getProduct(Number(id))
  if (!product) notFound()
  const [widths, addonOptions, addonIds, addonsTitle] = await Promise.all([
    readProductWidths(product.id),
    readAddonOptions(),
    readProductAddons(product.id),
    readAddonsTitle(),
  ])

  // الأقسام اللي المنتج فيها — عرض بس، الربط من صفحة القسم
  const collections = await adminData.listCollections()
  const details = await Promise.all(collections.map((collection) => adminData.getCollection(collection.id)))
  const sections = details.filter(
    (detail): detail is NonNullable<typeof detail> => detail !== null && detail.productIds.includes(product.id),
  )

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

      <Card className="mb-4" title="الأقسام">
        {sections.length === 0 ? (
          <p className="text-xs text-muted">
            المنتج ده مش في أي قسم.{' '}
            <Link href="/collections" className="font-semibold text-accent">
              اربطه من صفحة الأقسام
            </Link>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {sections.map((section) => (
              <Link
                key={section.id}
                href={'/collections/' + section.id}
                className="rounded-full border border-border bg-bg px-3 py-1 text-xs font-semibold text-fg transition-colors hover:border-muted"
              >
                {section.title}
              </Link>
            ))}
            <span className="text-xs text-muted">· الإضافة والشيل من صفحة القسم</span>
          </div>
        )}
      </Card>

      <ProductEditor
        product={product}
        widths={widths}
        addonOptions={addonOptions}
        addonIds={addonIds}
        addonsTitle={addonsTitle}
      />
    </>
  )
}
