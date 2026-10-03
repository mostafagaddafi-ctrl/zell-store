import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Layers, Plus } from 'lucide-react'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { ProductEditor } from '../../../../components/products/ProductEditor'
import { buttonClasses } from '../../../../components/ui/Button'
import { EmptyState } from '../../../../components/ui/EmptyState'
import { PreviewNotice } from '../../../../components/ui/PreviewNotice'
import { adminData } from '../../../../lib/adminData'
import { requireAdminPage } from '../../../../lib/auth/guards'

export const metadata: Metadata = { title: 'منتج جديد' }

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * منتج جديد — **لازم يكون في قسم**.
 *
 * من غير ?collection= الصفحة بتطلب اختيار القسم الأول. والقاعدة نفسها
 * متطبّقة على السيرفر في saveProductAction — مش في الواجهة بس.
 */
export default async function NewProductPage({ searchParams }: PageProps) {
  await requireAdminPage()

  const params = await searchParams

  // 0016 — إضافة / منتج بالقطعة: من غير قسم
  if (params['kind'] === 'piece') {
    return (
      <>
        <Link href="/products" className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-accent">
          <ArrowRight className="h-3.5 w-3.5" />
          المنتجات
        </Link>
        <PageHeader
          title="إضافة / منتج بالقطعة"
          description="أدوات أو أي حاجة من غير مقاسات — بتتباع بالعدد ومش لازم تبقى في قسم"
        />
        <ProductEditor product={null} initialSaleUnit="piece" />
      </>
    )
  }
  const requested = typeof params['collection'] === 'string' ? params['collection'] : null
  const collection = requested && /^[0-9]+$/.test(requested) ? await adminData.getCollection(requested) : null

  if (!collection) {
    const collections = await adminData.listCollections()
    return (
      <>
        <Link href="/products" className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-accent">
          <ArrowRight className="h-3.5 w-3.5" />
          المنتجات
        </Link>

        <PageHeader title="منتج جديد" description="كل منتج لازم يكون في قسم — اختار القسم الأول" />

        <Link href="/products/new?kind=piece" className={buttonClasses('secondary', 'sm', 'mb-4')}>
          <Plus className="h-4 w-4" />
          إضافة / منتج بالقطعة (من غير قسم)
        </Link>

        {collections.length === 0 ? (
          <div className="space-y-3">
            <EmptyState title="مفيش أقسام لسه" description="اعمل قسم الأول، وبعدين ضيف المنتجات جواه." />
            <Link href="/collections/new" className={buttonClasses('primary', 'md')}>
              <Plus className="h-4 w-4" />
              قسم جديد
            </Link>
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {collections.map((item) => (
              <li key={item.id}>
                <Link
                  href={'/products/new?collection=' + encodeURIComponent(item.id)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-card transition-colors hover:border-muted"
                >
                  <Layers className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{item.title}</span>
                    <span className="block text-xs text-muted">{String(item.productCount) + ' منتج'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <>
      <Link
        href={'/products?collection=' + encodeURIComponent(collection.id)}
        className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-accent"
      >
        <ArrowRight className="h-3.5 w-3.5" />
        {'منتجات «' + collection.title + '»'}
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
        description={'هيتضاف لقسم «' + collection.title + '» بعد الحفظ'}
        actions={
          <Link href="/products/new" className={buttonClasses('secondary', 'sm')}>
            غيّر القسم
          </Link>
        }
      />

      <ProductEditor product={null} collectionId={collection.id} />
    </>
  )
}
