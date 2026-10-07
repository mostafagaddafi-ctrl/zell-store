import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { DocStatusBadge } from '../../../../components/inventory/InvStatusBadge'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { buttonClasses } from '../../../../components/ui/Button'
import { EmptyState } from '../../../../components/ui/EmptyState'
import { inputClasses } from '../../../../components/ui/Field'
import { Table, TD, TH, THead, TR } from '../../../../components/ui/Table'
import { requireAdminPage } from '../../../../lib/auth/guards'
import { formatDate } from '../../../../lib/format'
import { DOC_STATUS_LABELS, type InventoryDocStatus } from '../../../../lib/inventory/labels'
import { formatPiastresExact } from '../../../../lib/inventory/money'
import { parseDocStatusParam, parseIdParam } from '../../../../lib/inventory/purchases'
import { listPurchases, loadSupplierOptions } from '../../../../lib/mutations/inventoryPurchases'

export const metadata: Metadata = { title: 'المشتريات' }
export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const STATUSES: InventoryDocStatus[] = ['draft', 'posted', 'discarded', 'voided']

function purchasesHref(status: InventoryDocStatus | null, supplierId: number | null, beforeId: number | null): string {
  const params = new URLSearchParams()
  if (status !== null) params.set('status', status)
  if (supplierId !== null) params.set('supplier', String(supplierId))
  if (beforeId !== null) params.set('before', String(beforeId))
  const query = params.toString()
  return query === '' ? '/inventory/purchases' : '/inventory/purchases?' + query
}

/**
 * فواتير الشراء (0020-UI · PR-B) — للمالك بس.
 * فلتر بالحالة وبالمورد، وتقسيم keyset بالأحدث (25 في الصفحة) من غير عدّ كلي.
 */
export default async function PurchasesPage({ searchParams }: PageProps) {
  const identity = await requireAdminPage()
  if (identity.role !== 'owner') redirect('/403')

  const params = await searchParams
  const status = parseDocStatusParam(params['status'])
  const supplierId = parseIdParam(params['supplier'])
  const beforeId = parseIdParam(params['before'])

  const [result, suppliers] = await Promise.all([
    listPurchases(identity.userId, { status, supplierId, beforeId }),
    loadSupplierOptions(identity.userId, true),
  ])

  return (
    <>
      <PageHeader
        title="المشتريات"
        description="فواتير الشراء. المسودة بتتعدل وتترحّل، والمرحّل بيعمل الدفعات بالتكلفة ومابيتعدلش (الإبطال بس)."
        actions={
          <Link href="/inventory/purchases/new" className={buttonClasses('primary', 'sm')}>
            <Plus className="h-3.5 w-3.5" />
            فاتورة جديدة
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Link href={purchasesHref(null, supplierId, null)} className={buttonClasses(status === null ? 'primary' : 'secondary', 'sm')}>
          الكل
        </Link>
        {STATUSES.map((option) => (
          <Link
            key={option}
            href={purchasesHref(option, supplierId, null)}
            className={buttonClasses(status === option ? 'primary' : 'secondary', 'sm')}
          >
            {DOC_STATUS_LABELS[option]}
          </Link>
        ))}

        {suppliers.ok ? (
          <form method="get" action="/inventory/purchases" className="ms-auto flex items-center gap-1.5">
            {status !== null ? <input type="hidden" name="status" value={status} /> : null}
            <select name="supplier" defaultValue={supplierId === null ? '' : String(supplierId)} className={inputClasses + ' w-48'} aria-label="المورد">
              <option value="">كل الموردين</option>
              {suppliers.data.items.map((supplier) => (
                <option key={supplier.supplierId} value={String(supplier.supplierId)}>
                  {supplier.name + (supplier.isActive ? '' : ' (موقوف)')}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClasses('secondary', 'sm')}>
              فلترة
            </button>
          </form>
        ) : null}
      </div>
      {suppliers.ok && !suppliers.data.complete ? (
        <p className="mb-3 text-xs text-muted">قايمة الموردين في الفلتر مش كاملة (أكتر من 500 مورد).</p>
      ) : null}

      {!result.ok ? (
        <div role="alert" className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs text-fg">
          <p className="font-semibold">مقدرناش نقرا فواتير الشراء.</p>
          <p className="text-muted">{result.code === 'INTERNAL' ? 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.' : result.message}</p>
        </div>
      ) : result.data.items.length === 0 ? (
        <EmptyState title="مفيش فواتير هنا" description="اعمل فاتورة شراء جديدة، أو غيّر الفلتر." />
      ) : (
        <div className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH>الرقم</TH>
                <TH>الحالة</TH>
                <TH>التاريخ</TH>
                <TH>المورد</TH>
                <TH>المخزن</TH>
                <TH>البنود / الدفعات</TH>
                <TH>إجمالي التكلفة</TH>
              </TR>
            </THead>
            <tbody>
              {result.data.items.map((doc) => (
                <TR key={doc.docId}>
                  <TD>
                    <Link href={'/inventory/purchases/' + String(doc.docId)} className="font-mono text-xs font-bold text-brand hover:underline">
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

          {beforeId !== null || result.data.nextBeforeId !== null ? (
            <div className="flex items-center justify-end gap-1.5">
              {beforeId !== null ? (
                <Link href={purchasesHref(status, supplierId, null)} className={buttonClasses('secondary', 'sm')}>
                  الأحدث
                </Link>
              ) : null}
              {result.data.nextBeforeId !== null ? (
                <Link href={purchasesHref(status, supplierId, result.data.nextBeforeId)} className={buttonClasses('secondary', 'sm')}>
                  الأقدم
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}
