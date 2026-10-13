import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { PageHeader } from '../../../components/shell/PageHeader'
import { ProductsTable } from '../../../components/products/ProductsTable'
import { buttonClasses } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { PreviewNotice } from '../../../components/ui/PreviewNotice'
import { adminData, type AdminProduct } from '../../../lib/adminData'
import { pageWithAccess } from '../../../lib/access/instance'
import { cn } from '../../../lib/cn'

export const metadata: Metadata = { title: 'المنتجات' }

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * المنتجات متصنّفة بالأقسام.
 *
 * تبويب لكل قسم بمنتجاته بترتيب القسم، و«بدون قسم» للمنتجات اللي
 * لسه ماتربطتش، و«الكل» للترتيب العام في المتجر.
 *
 * ⚠️ أسهم الترتيب شغّالة في «الكل» بس: zell_reorder_products لازم تاخد
 *    **كل** المنتجات. ترتيب المنتجات جوه القسم من صفحة القسم نفسها.
 *
 * المنتج ينفع يبقى في أكتر من قسم — فبيظهر تحت كل قسم هو فيه.
 */
export default pageWithAccess('zell.products.view', async function ProductsPage(_ctx, { searchParams }: PageProps) {
  const params = await searchParams
  const requested = typeof params['collection'] === 'string' ? params['collection'] : 'all'

  const [products, collections] = await Promise.all([adminData.listProducts(), adminData.listCollections()])
  const details = await Promise.all(collections.map((collection) => adminData.getCollection(collection.id)))

  const linked = new Map<string, number[]>()
  for (const detail of details) if (detail) linked.set(detail.id, detail.productIds)
  const inAnySection = new Set<number>()
  for (const ids of linked.values()) for (const id of ids) inAnySection.add(id)

  const byId = new Map(products.map((product) => [product.id, product]))
  const unsectioned = new Set(products.filter((product) => !inAnySection.has(product.id)).map((product) => product.id))
  const current = collections.find((collection) => collection.id === requested) ?? null
  const selected = requested === 'none' ? 'none' : current ? current.id : 'all'

  let shown: AdminProduct[] = products
  if (selected === 'none') shown = products.filter((product) => !inAnySection.has(product.id))
  else if (current) {
    shown = (linked.get(current.id) ?? [])
      .map((id) => byId.get(id))
      .filter((product): product is AdminProduct => product !== undefined)
  }

  const tabs = [
    { key: 'all', label: 'الكل', count: products.length },
    ...collections.map((collection) => ({
      key: collection.id,
      label: collection.title,
      count: linked.get(collection.id)?.length ?? 0,
    })),
    { key: 'none', label: 'بدون قسم', count: products.filter((product) => !inAnySection.has(product.id)).length },
  ]

  const newHref = current ? '/products/new?collection=' + encodeURIComponent(current.id) : '/products/new'

  return (
    <>
      <PageHeader
        title="المنتجات"
        description={
          current
            ? 'منتجات قسم «' + current.title + '» بترتيب القسم'
            : selected === 'none'
              ? 'منتجات لسه مش في أي قسم'
              : 'الترتيب هنا هو نفس ترتيب الظهور في المتجر'
        }
        actions={
          <Link href={newHref} className={buttonClasses('primary', 'md')}>
            <Plus className="h-4 w-4" />
            {current ? 'منتج جديد في القسم ده' : 'منتج جديد'}
          </Link>
        }
      />

      <nav aria-label="تصنيف المنتجات" className="-mx-4 mb-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1.5">
          {tabs.map((tab) => {
            const active = tab.key === selected
            const href = tab.key === 'all' ? '/products' : '/products?collection=' + encodeURIComponent(tab.key)
            return (
              <li key={tab.key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
                    active ? 'border-brand bg-brand text-brand-fg' : 'border-border bg-surface text-fg hover:border-muted',
                  )}
                >
                  {tab.label}
                  <span className={cn('rounded-full px-1.5 text-[11px]', active ? 'bg-brand-fg/20' : 'bg-bg text-muted')}>
                    {tab.count}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="mb-4 space-y-2">
        <PreviewNotice what="الإضافة والتعديل والإظهار والترتيب" />
        {current ? (
          <p className="text-xs text-muted">
            ترتيب المنتجات جوه القسم وإضافتها وشيلها من{' '}
            <Link href={'/collections/' + current.id} className="font-semibold text-accent">
              صفحة القسم
            </Link>
            . أسهم الترتيب للترتيب العام، وتعمل في «الكل» فقط.
          </p>
        ) : selected === 'none' ? (
          <p className="text-xs text-muted">
            المنتجات دي مش ظاهرة في أي قسم. اربطها من{' '}
            <Link href="/collections" className="font-semibold text-accent">
              صفحة الأقسام
            </Link>
            .
          </p>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={current ? 'القسم ده لسه مفيهوش منتجات' : selected === 'none' ? 'كل المنتجات في أقسام' : 'مفيش منتجات لسه'}
          description={current ? 'ضيف منتج جديد من الزرار فوق، أو اربط منتجات موجودة من صفحة القسم.' : ''}
        />
      ) : (
        <ProductsTable products={shown} reorderable={selected === 'all'} unsectioned={unsectioned} />
      )}
    </>
  )
})
