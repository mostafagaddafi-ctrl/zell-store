import Link from 'next/link'
import { AlertTriangle, Check, ShoppingCart } from 'lucide-react'
import { PageHeader } from '../../components/shell/PageHeader'
import { StatusBadge } from '../../components/orders/StatusBadge'
import { Badge } from '../../components/ui/Badge'
import { buttonClasses } from '../../components/ui/Button'
import { Card } from '../../components/ui/Field'
import { Table, TD, TH, THead, TR } from '../../components/ui/Table'
import { adminData } from '../../lib/adminData'
import { formatDateTime, formatPiastres } from '../../lib/format'
import { pageWithAccess } from '../../lib/access/instance'

export default pageWithAccess('zell.dashboard.view', async function OverviewPage(_ctx) {
  const [summary, latest, operational] = await Promise.all([
    adminData.getOrdersSummary(),
    adminData.listOrders({ page: 1, pageSize: 5, status: 'all' }),
    adminData.getOperationalSettings(),
  ])

  const readyCount = operational.readiness.filter((check) => check.ok).length

  return (
    <>
      <PageHeader title="نظرة عامة" description="ملخص التشغيل وحالة المتجر" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="طلبات جديدة" value={String(summary.newCount)} tone={summary.newCount > 0 ? 'warn' : 'ok'} />
        <Stat label="طلبات النهارده" value={String(summary.todayCount)} />
        <Stat label="إجمالي الطلبات" value={String(summary.totalOrders)} />
        <Stat label="مبيعات الشهر" value={formatPiastres(summary.salesMonthPiastres)} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card
          title="آخر الطلبات"
          className="min-w-0 xl:col-span-2"
          actions={
            <Link href="/orders" className={buttonClasses('secondary', 'sm')}>
              كل الطلبات
            </Link>
          }
        >
          {/*
            ⚠️ الموبايل: قائمة بدل الجدول. الجدول عرضه الأدنى 42rem، وجوه
               grid كان بيوسّع العمود فالصفحة كلها تبقى أعرض من الشاشة —
               المتصفح يصغّرها (خط صغير وشكل ديسكتوب) والقائمة تطلع من حافة
               الصفحة العريضة بدل حافة الشاشة.
          */}
          {latest.rows.length === 0 ? (
            <p className="text-xs text-muted md:hidden">مفيش طلبات لسه.</p>
          ) : (
            <ul className="divide-y divide-border md:hidden">
              {latest.rows.map((order) => (
                <li key={order.id}>
                  <Link
                    href={'/orders/' + order.orderNumber}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-accent">{order.orderNumber}</p>
                      <p className="truncate text-xs text-muted">
                        {order.customerName} · {formatDateTime(order.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={order.status} />
                      <span className="text-xs font-semibold text-fg">{formatPiastres(order.totalPiastres)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Table className="hidden border-0 md:block">
            <THead>
              <TR>
                <TH>رقم الطلب</TH>
                <TH>العميل</TH>
                <TH>الحالة</TH>
                <TH>الإجمالي</TH>
                <TH>التاريخ</TH>
              </TR>
            </THead>
            <tbody>
              {latest.rows.map((order) => (
                <TR key={order.id}>
                  <TD>
                    <Link href={'/orders/' + order.orderNumber} className="font-semibold text-accent">
                      {order.orderNumber}
                    </Link>
                  </TD>
                  <TD>{order.customerName}</TD>
                  <TD>
                    <StatusBadge status={order.status} />
                  </TD>
                  <TD className="font-semibold">{formatPiastres(order.totalPiastres)}</TD>
                  <TD className="text-xs text-muted">{formatDateTime(order.createdAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card className="min-w-0" title={'مؤشر الجاهزية · ' + String(readyCount) + '/' + String(operational.readiness.length)}>
          <ul className="space-y-2.5">
            {operational.readiness.map((check) => (
              <li key={check.key} className="flex items-start gap-2">
                {/* تلات حالات: سليم · تحذير · «مش عارفين». مفيش أيقونة جديدة — */}
                {/* نفس AlertTriangle بلون باهت للمحايدة، عشان ما تتخلطش بالسليم. */}
                {check.state === 'ok' ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                ) : (
                  <AlertTriangle
                    className={
                      'mt-0.5 h-4 w-4 shrink-0 ' + (check.state === 'unknown' ? 'text-muted' : 'text-danger')
                    }
                  />
                )}
                <div className="min-w-0 break-words">
                  <p className="text-xs font-semibold text-fg">{check.label}</p>
                  <p className="text-xs text-muted">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
})

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3.5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{label}</p>
        {tone ? (
          <Badge tone={tone}>
            <ShoppingCart className="h-3 w-3" />
          </Badge>
        ) : null}
      </div>
      <p className="mt-1.5 text-xl font-extrabold text-fg">{value}</p>
    </div>
  )
}
