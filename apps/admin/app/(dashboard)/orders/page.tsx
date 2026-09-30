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
import { formatDateTime, formatPiastres } from '../../../lib/format'
import { requireAdminPage } from '../../../lib/auth/guards'

export const metadata: Metadata = { title: 'الطلبات' }

const PAGE_SIZE = 20

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function readStatus(value: string | string[] | undefined): OrderStatus | 'all' {
  if (typeof value !== 'string') return 'all'
  return (ORDER_STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : 'all'
}

export default async function OrdersPage({ searchParams }: PageProps) {
  await requireAdminPage()

  const params = await searchParams
  const pageRaw = typeof params['page'] === 'string' ? Number(params['page']) : 1
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
  const search = typeof params['search'] === 'string' ? params['search'] : ''

  const result = await adminData.listOrders({
    page,
    pageSize: PAGE_SIZE,
    status: readStatus(params['status']),
    search,
  })

  return (
    <>
      <PageHeader title="الطلبات" description="البحث والفلترة بيتمّوا على السيرفر" />

      <div className="space-y-3">
        <OrdersFilters />

        {result.rows.length === 0 ? (
          <EmptyState title="مفيش طلبات مطابقة" description="جرّب تغيّر البحث أو الفلتر." />
        ) : (
          <>
            <Table>
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
                    <TD className="text-xs">{order.governorate}</TD>
                    <TD className="text-xs">{order.itemCount}</TD>
                    <TD className="font-semibold">{formatPiastres(order.totalPiastres)}</TD>
                    <TD>
                      <StatusBadge status={order.status} />
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
}
