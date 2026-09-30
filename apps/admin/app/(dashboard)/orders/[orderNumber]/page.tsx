import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, MessageCircle, Phone } from 'lucide-react'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { StatusBadge } from '../../../../components/orders/StatusBadge'
import { Button, buttonClasses } from '../../../../components/ui/Button'
import { Card, textareaClasses } from '../../../../components/ui/Field'
import { PreviewNotice } from '../../../../components/ui/PreviewNotice'
import { Table, TD, TH, THead, TR } from '../../../../components/ui/Table'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, adminData } from '../../../../lib/adminData'
import { formatDateTime, formatLength, formatPiastres } from '../../../../lib/format'
import { requireAdminPage } from '../../../../lib/auth/guards'

type PageProps = { params: Promise<{ orderNumber: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orderNumber } = await params
  return { title: 'طلب ' + orderNumber }
}

export default async function OrderDetailPage({ params }: PageProps) {
  await requireAdminPage()

  const { orderNumber } = await params
  const order = await adminData.getOrder(orderNumber)
  if (!order) notFound()

  const waHref = 'https://wa.me/2' + order.customerPhone

  return (
    <>
      <Link href="/orders" className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-accent">
        <ArrowRight className="h-3.5 w-3.5" />
        كل الطلبات
      </Link>

      <PageHeader
        title={order.orderNumber}
        description={formatDateTime(order.createdAt)}
        actions={<StatusBadge status={order.status} />}
      />

      <div className="mb-4">
        <PreviewNotice what="تغيير الحالة والملاحظات وإعادة الإشعار" />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="الأصناف">
            <Table className="border-0">
              <THead>
                <TR>
                  <TH>المنتج</TH>
                  <TH>الطول</TH>
                  <TH>سعر المتر</TH>
                  <TH>الإجمالي</TH>
                </TR>
              </THead>
              <tbody>
                {order.items.map((item, index) => (
                  <TR key={index}>
                    <TD className="font-medium">{item.productNameAr}</TD>
                    <TD>{formatLength(item.lengthCm)}</TD>
                    <TD>{formatPiastres(item.unitPricePiastres)}</TD>
                    <TD className="font-semibold">{formatPiastres(item.lineTotalPiastres)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>

            <dl className="mt-4 space-y-1.5 text-sm">
              <Row label="الأصناف" value={formatPiastres(order.subtotalPiastres)} />
              <Row label="الشحن" value={formatPiastres(order.shippingPiastres)} />
              <div className="flex items-center justify-between border-t border-border pt-2">
                <dt className="font-bold text-fg">الإجمالي</dt>
                <dd className="text-base font-extrabold text-brand">{formatPiastres(order.totalPiastres)}</dd>
              </div>
            </dl>
          </Card>

          <Card title="ملاحظات داخلية">
            <textarea
              defaultValue={order.internalNotes ?? ''}
              placeholder="ملاحظات للفريق — ما بتظهرش للعميل"
              className={textareaClasses}
              disabled
            />
            <p className="mt-2 text-xs text-muted">الحفظ معطّل في مرحلة المعاينة.</p>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="العميل">
            <dl className="space-y-2 text-sm">
              <Row label="الاسم" value={order.customerName} />
              <Row label="الموبايل" value={order.customerPhone} ltr />
              <Row label="المحافظة" value={order.governorate} />
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-muted">{order.address}</p>
            {order.notes ? (
              <p className="mt-3 rounded border-s-2 border-gold bg-bg p-2 text-xs text-fg">{order.notes}</p>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <a href={'tel:' + order.customerPhone} className={buttonClasses('secondary', 'sm', 'w-full')}>
                <Phone className="h-3.5 w-3.5" />
                اتصال
              </a>
              <a href={waHref} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm', 'w-full')}>
                <MessageCircle className="h-3.5 w-3.5" />
                واتساب
              </a>
            </div>
          </Card>

          <Card title="الحالة">
            <div className="grid grid-cols-2 gap-1.5">
              {ORDER_STATUSES.map((status) => (
                <Button key={status} variant={status === order.status ? 'primary' : 'secondary'} size="sm" disabled>
                  {ORDER_STATUS_LABELS[status]}
                </Button>
              ))}
            </div>
          </Card>

          <Card title="الإشعار">
            {order.notifiedAt ? (
              <p className="text-xs text-ok">اتبعت في {formatDateTime(order.notifiedAt)}</p>
            ) : (
              <p className="text-xs text-danger">{order.notifyError ?? 'ما اتبعتش'}</p>
            )}
            <Button variant="secondary" size="sm" className="mt-3" disabled>
              إعادة إرسال الإشعار
            </Button>
          </Card>
        </div>
      </div>
    </>
  )
}

function Row({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-fg" dir={ltr ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  )
}
