import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '../../../components/shell/PageHeader'
import { OrdersFilters } from '../../../components/orders/OrdersFilters'
import { Pagination } from '../../../components/orders/Pagination'
import { StatusBadge } from '../../../components/orders/StatusBadge'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Table, TD, TH, THead, TR } from '../../../components/ui/Table'
import { ORDER_STATUSES, adminData, type OrderStatus } from '../../../lib/adminData'
import { FOLLOW_UP_FILTER_LABELS, readFollowUpFilter } from '../../../lib/orders/cycle'
import { FollowUpBadge } from '../../../components/orders/FollowUpBadge'
import { formatDateTime, formatPiastres } from '../../../lib/format'
import { pageWithAccess } from '../../../lib/access/instance'

export const metadata: Metadata = { title: 'الطلبات' }

const PAGE_SIZE = 20

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function readStatus(value: string | string[] | undefined): OrderStatus | 'all' {
  if (typeof value !== 'string') return 'all'
  return (ORDER_STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : 'all'
}

export default pageWithAccess('zell.orders.view', async function OrdersPage(_ctx, { searchParams }: PageProps) {
  const params = await searchParams
  const pageRaw = typeof params['page'] === 'string' ? Number(params['page']) : 1
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
  const search = typeof params['search'] === 'string' ? params['search'] : ''
  // 0021-A A2 — فلتر المتابعة (الطلبات الجديدة بس، بتوقيت القاهرة)
  const followUp = readFollowUpFilter(params['followup'])

  const result = await adminData.listOrders({
    page,
    pageSize: PAGE_SIZE,
    status: readStatus(params['status']),
    search,
    followUp,
  })
  const followUpCounts = await adminData.getFollowUpCounts()
  const now = Date.now()

  return (
    <>
      <PageHeader title="الطلبات" description="البحث والفلترة بيتمّوا على السيرفر" />

      <div className="space-y-3">
        <OrdersFilters />

        {/* 0021-A A2 — تنبيه المتابعات (الطلبات الجديدة بس، بتوقيت القاهرة) */}
        {followUpCounts.overdue + followUpCounts.today > 0 ? (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-gold bg-gold/10 p-3 text-sm">
            <span className="font-bold text-fg">متابعات:</span>
            <Link href="/orders?followup=overdue" className="font-semibold text-danger">
              {FOLLOW_UP_FILTER_LABELS.overdue + ' (' + String(followUpCounts.overdue) + ')'}
            </Link>
            <span className="text-muted">·</span>
            <Link href="/orders?followup=today" className="font-semibold text-accent">
              {FOLLOW_UP_FILTER_LABELS.today + ' (' + String(followUpCounts.today) + ')'}
            </Link>
          </div>
        ) : null}
        {followUp !== null ? (
          <p className="text-xs text-muted">{'فلتر: ' + FOLLOW_UP_FILTER_LABELS[followUp] + ' — الطلبات الجديدة بس، بالأقرب.'}</p>
        ) : null}

        {result.rows.length === 0 ? (
          <EmptyState title="مفيش طلبات مطابقة" description="جرّب تغيّر البحث أو الفلتر." />
        ) : (
          <>
            {/* الموبايل: كروت بدل جدول عرضه 42rem بيعمل سكرول جانبي */}
            <ul className="space-y-2 md:hidden">
              {result.rows.map((order) => (
                <li key={order.id}>
                  <Link
                    href={'/orders/' + order.orderNumber}
                    className="block rounded-lg border border-border bg-surface p-3 shadow-card transition-colors active:bg-bg"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-accent">{order.orderNumber}</p>
                        <p className="mt-0.5 truncate text-sm font-medium text-fg">{order.customerName}</p>
                        <span className="inline-block text-xs text-muted" dir="ltr">
                          {order.customerPhone}
                        </span>
                        {order.needsInstaller ? (
                          <span className="mt-1 block w-fit rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-bold text-accent">
                            {order.installationRequested
                              ? '🔧 فني · ' + formatPiastres(order.installationPiastres + order.installationTravelPiastres)
                              : '🔧 فني (بالتواصل)'}
                          </span>
                        ) : null}
                        <FollowUpBadge at={order.nextFollowUpAt} status={order.status} now={now} className="mt-1 flex w-fit" />
                        {order.couponCode ? (
                          <span className="mt-1 block w-fit">
                            <Badge tone="info">{'كوبون ' + order.couponCode}</Badge>
                          </span>
                        ) : null}
                      </div>
                      <StatusBadge status={order.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted">
                      <span>
                        {order.governorate}
                        {order.shippingArea ? ' — ' + order.shippingArea : ''} · {order.itemCount} صنف
                      </span>
                      <span className="text-sm font-bold text-fg">{formatPiastres(order.totalPiastres)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-muted">
                      <span>{formatDateTime(order.createdAt)}</span>
                      {order.notifiedAt ? (
                        <Badge tone="ok">الإشعار اتبعت</Badge>
                      ) : order.notifyError ? (
                        <Badge tone="danger">الإشعار فشل</Badge>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            <Table className="hidden md:block">
              <THead>
                <TR>
                  <TH>رقم الطلب</TH>
                  <TH>العميل</TH>
                  <TH>المحافظة</TH>
                  <TH>الأصناف</TH>
                  <TH>الإجمالي</TH>
                  <TH>الحالة</TH>
                  <TH>الإشعار</TH>
                  <TH>التاريخ</TH>
                </TR>
              </THead>
              <tbody>
                {result.rows.map((order) => (
                  <TR key={order.id}>
                    <TD>
                      <Link href={'/orders/' + order.orderNumber} className="font-semibold text-accent">
                        {order.orderNumber}
                      </Link>
                    </TD>
                    <TD>
                      <span className="block font-medium">{order.customerName}</span>
                      <span className="block text-xs text-muted" dir="ltr">
                        {order.customerPhone}
                      </span>
                    </TD>
                    <TD className="text-xs">
                      {order.governorate}
                      {order.shippingArea ? <span className="block text-muted">{order.shippingArea}</span> : null}
                    </TD>
                    <TD className="text-xs">{order.itemCount}</TD>
                    <TD className="font-semibold">{formatPiastres(order.totalPiastres)}</TD>
                    <TD>
                      <StatusBadge status={order.status} />
                      <FollowUpBadge at={order.nextFollowUpAt} status={order.status} now={now} className="ms-1.5 align-middle" />
                      {order.needsInstaller ? (
                        <span className="ms-1.5 inline-block rounded bg-accent/10 px-1.5 py-0.5 align-middle text-[11px] font-bold text-accent">
                          {order.installationRequested
                            ? '🔧 فني · ' + formatPiastres(order.installationPiastres + order.installationTravelPiastres)
                            : '🔧 فني (بالتواصل)'}
                        </span>
                      ) : null}
                      {order.couponCode ? (
                        <Badge tone="info" className="ms-1.5 align-middle">
                          {'كوبون ' + order.couponCode}
                        </Badge>
                      ) : null}
                    </TD>
                    <TD>
                      {order.notifiedAt ? (
                        <Badge tone="ok">اتبعت</Badge>
                      ) : order.notifyError ? (
                        <Badge tone="danger">فشل</Badge>
                      ) : (
                        <Badge>—</Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(order.createdAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>

            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </div>
    </>
  )
})
