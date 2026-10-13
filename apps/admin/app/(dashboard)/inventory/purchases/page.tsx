import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { DocListToolbar } from '../../../../components/inventory/DocListToolbar'
import { DocStatusBadge } from '../../../../components/inventory/InvStatusBadge'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { buttonClasses } from '../../../../components/ui/Button'
import { EmptyState } from '../../../../components/ui/EmptyState'
import { Table, TD, TH, THead, TR } from '../../../../components/ui/Table'
import { pageWithAccess } from '../../../../lib/access/instance'
import { formatDate } from '../../../../lib/format'
import {
  DOC_LIST_PAGE_SIZE,
  DOC_LIST_WIDE_PAGE_SIZE,
  docListHref,
  docMatches,
  emptyListTitle,
  parseDocQuery,
  parseDocTab,
  tabAllows,
  tabServerStatus,
  usesWidePage,
} from '../../../../lib/inventory/docList'
import { formatPiastresExact } from '../../../../lib/inventory/money'
import { parseIdParam } from '../../../../lib/inventory/purchases'
import { listPurchases, loadSupplierOptions } from '../../../../lib/data/inventoryPurchases'

export const metadata: Metadata = { title: 'المشتريات' }
export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const BASE = '/inventory/purchases'

/**
 * فواتير الشراء (0020-UI) — للمالك بس.
 * تبويبات الحالة (الافتراضي «النشط»: مسودة + مرحّل) · بحث برقم الفاتورة / المورد / التاريخ · فلتر بالمورد ·
 * الأحدث أولًا بتقسيم keyset من غير عدّ كلي. «النشط» والبحث بيقروا لحد 100 فاتورة في الصفحة. منطق القايمة في lib/inventory/docList.ts.
 */
export default pageWithAccess('zell.inventory0020.view', async function PurchasesPage(_ctx, { searchParams }: PageProps) {

  const params = await searchParams
  const tab = parseDocTab(params['tab'], params['status'])
  const query = parseDocQuery(params['q'])
  const supplierId = parseIdParam(params['supplier'])
  const beforeId = parseIdParam(params['before'])
  const limit = usesWidePage(tab, query) ? DOC_LIST_WIDE_PAGE_SIZE : DOC_LIST_PAGE_SIZE

  const [result, suppliers] = await Promise.all([
    listPurchases({ status: tabServerStatus(tab), supplierId, beforeId, limit }),
    loadSupplierOptions(true),
  ])

  const rows = result.ok
    ? result.data.items.filter(
        (doc) => tabAllows(tab, doc.status) && docMatches(query, { docNo: doc.docNo, supplierName: doc.supplierName, date: doc.docDate }),
      )
    : []
  const href = (before: number | null) => docListHref(BASE, { tab, query, supplierId, beforeId: before })

  return (
    <>
      <PageHeader
        title="المشتريات"
        description="فواتير الشراء. يمكن تعديل المسودة وترحيلها، والفاتورة المرحّلة تُنشئ دفعات المخزون بالتكلفة ولا تُعدَّل (الإبطال فقط)."
        actions={
          <Link href="/inventory/purchases/new" className={buttonClasses('primary', 'sm')}>
            <Plus className="h-3.5 w-3.5" />
            فاتورة جديدة
          </Link>
        }
      />

      <DocListToolbar
        base={BASE}
        tab={tab}
        query={query}
        placeholder="ابحث برقم الفاتورة أو المورد أو التاريخ"
        supplierId={supplierId}
        suppliers={
          suppliers.ok
            ? suppliers.data.items.map((supplier) => ({ id: supplier.supplierId, label: supplier.name + (supplier.isActive ? '' : ' (موقوف)') }))
            : null
        }
      />
      {suppliers.ok && !suppliers.data.complete ? (
        <p className="mb-3 text-xs text-muted">قايمة الموردين في الفلتر مش كاملة (أكتر من 500 مورد).</p>
      ) : null}
      {query !== '' ? (
        <p className="mb-3 text-xs text-muted">البحث في آخر {DOC_LIST_WIDE_PAGE_SIZE} فاتورة (الأحدث أولًا). للأقدم اضغط «الأقدم» تحت.</p>
      ) : null}

      {!result.ok ? (
        <div role="alert" className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs text-fg">
          <p className="font-semibold">مقدرناش نقرا فواتير الشراء.</p>
          <p className="text-muted">{result.code === 'INTERNAL' ? 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.' : result.message}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.length === 0 ? (
            <EmptyState
              title={emptyListTitle('purchase', tab, query)}
              description={
                query !== ''
                  ? 'جرّب جزء من رقم الفاتورة، أو اسم المورد، أو التاريخ زي 2026-10.'
                  : tab === 'active' || tab === 'all' || tab === 'draft'
                    ? 'اعمل فاتورة شراء جديدة من الزرار فوق.'
                    : 'غيّر التبويب لـ «النشط» أو «الكل».'
              }
            />
          ) : (
            <>
              <ul className="space-y-2 sm:hidden">
                {rows.map((doc) => (
                  <li key={doc.docId}>
                    <Link href={BASE + '/' + String(doc.docId)} className="block rounded-lg border border-border bg-surface p-3 hover:border-brand">
                      <div className="flex items-center justify-between gap-2">
                        <bdi dir="ltr" className="font-mono text-xs font-bold text-brand">
                          {doc.docNo}
                        </bdi>
                        <DocStatusBadge status={doc.status} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        <span>{formatDate(doc.docDate)}</span>
                        <span>{doc.supplierName ?? 'من غير مورد'}</span>
                        <span>{doc.locationName}</span>
                      </div>
                      <div className="mt-1.5 text-sm font-semibold text-fg">{formatPiastresExact(doc.totalCostPiastres)}</div>
                    </Link>
                  </li>
                ))}
              </ul>
              <Table className="hidden sm:block">
                <THead>
                  <TR>
                    <TH>الرقم</TH>
                    <TH>الحالة</TH>
                    <TH>التاريخ</TH>
                    <TH>المورد</TH>
                    <TH>المخزن</TH>
                    <TH>البنود / دفعات المخزون</TH>
                    <TH>إجمالي التكلفة</TH>
                  </TR>
                </THead>
                <tbody>
                  {rows.map((doc) => (
                    <TR key={doc.docId}>
                      <TD>
                        <Link href={BASE + '/' + String(doc.docId)} className="font-mono text-xs font-bold text-brand hover:underline">
                          <bdi dir="ltr">{doc.docNo}</bdi>
                        </Link>
                      </TD>
                      <TD>
                        <DocStatusBadge status={doc.status} />
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(doc.docDate)}</TD>
                      <TD>{doc.supplierName ?? '—'}</TD>
                      <TD>{doc.locationName}</TD>
                      <TD>
                        {doc.lineCount} / {doc.status === 'posted' || doc.status === 'voided' ? String(doc.lotCount) : '—'}
                      </TD>
                      <TD className="whitespace-nowrap font-semibold">{formatPiastresExact(doc.totalCostPiastres)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </>
          )}

          {beforeId !== null || result.data.nextBeforeId !== null ? (
            <div className="flex items-center justify-end gap-1.5">
              {beforeId !== null ? (
                <Link href={href(null)} className={buttonClasses('secondary', 'sm')}>
                  الأحدث
                </Link>
              ) : null}
              {result.data.nextBeforeId !== null ? (
                <Link href={href(result.data.nextBeforeId)} className={buttonClasses('secondary', 'sm')}>
                  الأقدم
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </>
  )
})
