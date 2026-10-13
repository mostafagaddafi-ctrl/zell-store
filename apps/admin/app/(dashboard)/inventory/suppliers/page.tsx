import type { Metadata } from 'next'
import Link from 'next/link'
import { LinkCheckbox } from '../../../../components/inventory/LinkCheckbox'
import { SuppliersList } from '../../../../components/inventory/SuppliersList'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { buttonClasses } from '../../../../components/ui/Button'
import { pageWithAccess } from '../../../../lib/access/instance'
import { parseSupplierCursor } from '../../../../lib/inventory/suppliers'
import { listSuppliers } from '../../../../lib/data/inventory'

export const metadata: Metadata = { title: 'الموردين' }
export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function suppliersHref(includeInactive: boolean, after: string | null): string {
  const params = new URLSearchParams()
  if (includeInactive) params.set('inactive', '1')
  if (after !== null) params.set('after', after)
  const query = params.toString()
  return query === '' ? '/inventory/suppliers' : '/inventory/suppliers?' + query
}

/**
 * الموردين (0020-UI · PR-A) — للمالك بس.
 * ⚠️ إخفاء الرابط مش الحماية: الصفحة بتتحقق من الدور هنا، وكل action في lib/inventoryActions،
 *    ودوال 0020 نفسها بتتأكد إن ممثل الجلسة مالك نشط.
 * التقسيم keyset بالاسم (25 في الصفحة) من غير عدّ كلي: «أول صفحة» و«التالي».
 */
export default pageWithAccess('zell.inventory0020.view', async function SuppliersPage(_ctx, { searchParams }: PageProps) {

  const params = await searchParams
  const includeInactive = params['inactive'] === '1'
  const after = parseSupplierCursor(params['after'])
  const result = await listSuppliers({ includeInactive, after })

  return (
    <>
      <PageHeader
        title="الموردين"
        description="الموردون المعتمدون للشراء. لا يظهر المورد الموقوف في الفواتير الجديدة، ولا يمكن حذف مورد."
        actions={
          <LinkCheckbox
            label="عرض الموردين الموقوفين"
            checked={includeInactive}
            onHref={suppliersHref(true, null)}
            offHref={suppliersHref(false, null)}
          />
        }
      />

      {result.ok ? (
        <div className="space-y-4">
          <SuppliersList rows={result.data.items} />

          {after !== null || result.data.nextAfterNameKey !== null ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {after === null ? 'أول صفحة' : 'صفحة تالية'} · {result.data.items.length} مورد
              </p>
              <div className="flex items-center gap-1.5">
                {after !== null ? (
                  <Link href={suppliersHref(includeInactive, null)} className={buttonClasses('secondary', 'sm')}>
                    أول صفحة
                  </Link>
                ) : null}
                {result.data.nextAfterNameKey !== null ? (
                  <Link
                    href={suppliersHref(includeInactive, result.data.nextAfterNameKey)}
                    className={buttonClasses('secondary', 'sm')}
                  >
                    التالي
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          role="alert"
          className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs leading-relaxed text-fg"
        >
          <p className="font-semibold">مقدرناش نقرا الموردين.</p>
          <p className="text-muted">
            {result.code === 'INTERNAL' ? 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.' : result.message}
          </p>
        </div>
      )}
    </>
  )
})
