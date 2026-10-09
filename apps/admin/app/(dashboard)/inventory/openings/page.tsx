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
import { listOpenings } from '../../../../lib/data/inventoryOpenings'

export const metadata: Metadata = { title: 'رصيد أول المدة' }
export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const BASE = '/inventory/openings'

/**
 * رصيد أول المدة (0020-UI) — للمالك بس. تبويبات الحالة (الافتراضي «النشط»)، وبحث برقم المستند أو التاريخ،
 * والأحدث أولًا بتقسيم keyset. منطق القايمة في lib/inventory/docList.ts.
 */
export default pageWithAccess('zell.inventory0020.view', async function OpeningsPage(_ctx, { searchParams }: PageProps) {

  const params = await searchParams
  const tab = parseDocTab(params['tab'], params['status'])
  const query = parseDocQuery(params['q'])
  const beforeId = parseIdParam(params['before'])
  const limit = usesWidePage(tab, query) ? DOC_LIST_WIDE_PAGE_SIZE : DOC_LIST_PAGE_SIZE
  const result = await listOpenings({ status: tabServerStatus(tab), beforeId, limit })

  const rows = result.ok
    ? result.data.items.filter(
        (doc) => tabAllows(tab, doc.status) && docMatches(query, { docNo: doc.docNo, supplierName: null, date: doc.asOfDate }),
      )
    : []
  const href = (before: number | null) => docListHref(BASE, { tab, query, beforeId: before })

  return (
    <>
      <PageHeader
        title="رصيد أول المدة"
        description="البضاعة الموجودة قبل بداية التسجيل. بتتحفظ مسودة، وبعد الترحيل بتعمل دفعات المخزون بالتكلفة (الفعلية أو التقديرية)."
        actions={
          <Link href="/inventory/openings/new" className={buttonClasses('primary', 'sm')}>
            <Plus className="h-3.5 w-3.5" />
            رصيد جديد
          </Link>
        }
      />

      <DocListToolbar base={BASE} tab={tab} query={query} placeholder="ابحث برقم المستند أو التاريخ" />
      {query !== '' ? (
        <p className="mb-3 text-xs text-muted">البحث في آخر {DOC_LIST_WIDE_PAGE_SIZE} مستند (الأحدث أولًا). للأقدم اضغط «الأقدم» تحت.</p>
      ) : null}

      {!result.ok ? (
        <div role="alert" className="space-y-1 rounded-lg border-s-2 border-danger bg-danger/5 px-3 py-2.5 text-xs text-fg">
          <p className="font-semibold">مقدرناش نقرا رصيد أول المدة.</p>
          <p className="text-muted">{result.code === 'INTERNAL' ? 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.' : result.message}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.length === 0 ? (
            <EmptyState
              title={emptyListTitle('opening', tab, query)}
              description={
                query !== ''
                  ? 'جرّب جزء من رقم المستند، أو التاريخ زي 2026-10.'
                  : tab === 'active' || tab === 'all' || tab === 'draft'
                    ? 'سجّل البضاعة الموجودة عندك برصيد أول مدة جديد من الزرار فوق.'
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
                        <span>{formatDate(doc.asOfDate)}</span>
                        <span>{doc.locationName}</span>
                        <span>{doc.lineCount} بند</span>
                      </div>
                      <div className="mt-1.5 text-sm font-semibold text-fg">
                        {formatPiastresExact(doc.itemsTotalPiastres)}
                        {doc.estimatedTotalPiastres > 0 ? (
                          <span className="ms-1 text-xs font-normal text-muted">(منه تقديري {formatPiastresExact(doc.estimatedTotalPiastres)})</span>
                        ) : null}
                      </div>
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
                    <TH>المخزن</TH>
                    <TH>البنود / دفعات المخزون</TH>
                    <TH>الإجمالي</TH>
                    <TH>منه تقديري</TH>
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
