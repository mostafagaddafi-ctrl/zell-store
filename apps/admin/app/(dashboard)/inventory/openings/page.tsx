import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { DocStatusBadge } from '../../../../components/inventory/InvStatusBadge'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { buttonClasses } from '../../../../components/ui/Button'
import { EmptyState } from '../../../../components/ui/EmptyState'
import { Table, TD, TH, THead, TR } from '../../../../components/ui/Table'
import { pageWithAccess } from '../../../../lib/access/instance'
import { formatDate } from '../../../../lib/format'
import { DOC_STATUS_LABELS, type InventoryDocStatus } from '../../../../lib/inventory/labels'
import { formatPiastresExact } from '../../../../lib/inventory/money'
import { parseDocStatusParam, parseIdParam } from '../../../../lib/inventory/purchases'
import { listOpenings } from '../../../../lib/data/inventoryOpenings'

export const metadata: Metadata = { title: 'رصيد أول المدة' }
export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const STATUSES: InventoryDocStatus[] = ['draft', 'posted', 'discarded', 'voided']

function openingsHref(status: InventoryDocStatus | null, beforeId: number | null): string {
  const params = new URLSearchParams()
  if (status !== null) params.set('status', status)
  if (beforeId !== null) params.set('before', String(beforeId))
  const query = params.toString()
  return query === '' ? '/inventory/openings' : '/inventory/openings?' + query
}

/** رصيد أول المدة (0020-UI · PR-C) — للمالك بس. فلتر بالحالة، و keyset بالأحدث (25). */
export default pageWithAccess('zell.inventory0020.view', async function OpeningsPage(_ctx, { searchParams }: PageProps) {

  const params = await searchParams
  const status = parseDocStatusParam(params['status'])
  const beforeId = parseIdParam(params['before'])
  const result = await listOpenings({ status, beforeId })

  return (
    <>
      <PageHeader
        title="رصيد أول المدة"
        description="البضاعة الموجودة قبل بداية التسجيل. بتتحفظ مسودة، وبعد الترحيل بتعمل الدفعات بالتكلفة (الفعلية أو التقديرية)."
        actions={
          <Link href="/inventory/openings/new" className={buttonClasses('primary', 'sm')}>
            <Plus className="h-3.5 w-3.5" />
            رصيد جديد
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Link href={openingsHref(null, null)} className={buttonClasses(status === null ? 'primary' : 'secondary', 'sm')}>
          الكل
        </Link>
        {STATUSES.map((option) => (
          <Link key={option} href={openingsHref(option, null)} className={buttonClasses(status === option ? 'primary' : 'secondary', 'sm')}>
            {DOC_STATUS_LABELS[option]}
          </Link>
        ))}
      </div>

      {!result.ok ? (
        <div role="alert" className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs text-fg">
          <p className="font-semibold">مقدرناش نقرا رصيد أول المدة.</p>
          <p className="text-muted">{result.code === 'INTERNAL' ? 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.' : result.message}</p>
        </div>
      ) : result.data.items.length === 0 ? (
        <EmptyState title="مفيش مستندات هنا" description="سجّل البضاعة الموجودة عندك برصيد أول مدة جديد، أو غيّر الفلتر." />
      ) : (
        <div className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH>الرقم</TH>
                <TH>الحالة</TH>
                <TH>التاريخ</TH>
                <TH>المخزن</TH>
                <TH>البنود / الدفعات</TH>
                <TH>الإجمالي</TH>
                <TH>منه تقديري</TH>
              </TR>
            </THead>
            <tbody>
              {result.data.items.map((doc) => (
                <TR key={doc.docId}>
                  <TD>
                    <Link href={'/inventory/openings/' + String(doc.docId)} className="font-mono text-xs font-bold text-brand hover:underline">
                      <bdi dir="ltr">{doc.docNo}</bdi>
                    </Link>
                  </TD>
                  <TD>
                    <DocStatusBadge status={doc.status} />
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(doc.asOfDate)}</TD>
                  <TD>{doc.locationName}</TD>
                  <TD>
                    {doc.lineCount} / {doc.status === 'posted' || doc.status === 'voided' ? String(doc.lotCount) : '—'}
                  </TD>
                  <TD className="whitespace-nowrap font-semibold">{formatPiastresExact(doc.itemsTotalPiastres)}</TD>
                  <TD className="whitespace-nowrap">{formatPiastresExact(doc.estimatedTotalPiastres)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
          {beforeId !== null || result.data.nextBeforeId !== null ? (
            <div className="flex items-center justify-end gap-1.5">
              {beforeId !== null ? (
                <Link href={openingsHref(status, null)} className={buttonClasses('secondary', 'sm')}>
                  الأحدث
                </Link>
              ) : null}
              {result.data.nextBeforeId !== null ? (
                <Link href={openingsHref(status, result.data.nextBeforeId)} className={buttonClasses('secondary', 'sm')}>
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
