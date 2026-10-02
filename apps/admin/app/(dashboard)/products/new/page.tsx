import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { ProductEditor } from '../../../../components/products/ProductEditor'
import { PreviewNotice } from '../../../../components/ui/PreviewNotice'
import { adminData } from '../../../../lib/adminData'
import { requireAdminPage } from '../../../../lib/auth/guards'

export const metadata: Metadata = { title: 'منتج جديد' }

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function NewProductPage({ searchParams }: PageProps) {
  await requireAdminPage()

  // منتج جديد من جوه قسم: بيتضاف آخر القسم بعد الحفظ
  const params = await searchParams
  const requested = typeof params['collection'] === 'string' ? params['collection'] : null
  const collection = requested && /^[0-9]+$/.test(requested) ? await adminData.getCollection(requested) : null
  const backHref = collection ? '/products?collection=' + encodeURIComponent(collection.id) : '/products'

  return (
    <>
      <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-accent">
        <ArrowRight className="h-3.5 w-3.5" />
        {collection ? 'منتجات «' + collection.title + '»' : 'المنتجات'}
      </Link>

      {/* التنبيه فوق قبل الفورم — مش في شريط الحفظ تحت بس */}
      <div className="mb-4">
        <PreviewNotice
          what="إنشاء منتج"
          note="مش هيتعمل أي منتج جديد، ومش هيتسجّل أي صف في قاعدة البيانات. الشاشة دي لمراجعة الشكل بس."
        />
      </div>

      <PageHeader
        title="منتج جديد"
        {...(collection ? { description: 'هيتضاف لقسم «' + collection.title + '» بعد الحفظ' } : {})}
      />

      {collection ? <ProductEditor product={null} collectionId={collection.id} /> : <ProductEditor product={null} />}
    </>
  )
}
