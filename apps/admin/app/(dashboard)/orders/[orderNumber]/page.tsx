import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, MessageCircle, Phone } from 'lucide-react'
import { PageHeader } from '../../../../components/shell/PageHeader'
import { OrderNotes, OrderStatusControls } from '../../../../components/orders/OrderActions'
import { StatusBadge } from '../../../../components/orders/StatusBadge'
import { Button, buttonClasses } from '../../../../components/ui/Button'
import { Card } from '../../../../components/ui/Field'
import { PreviewNotice } from '../../../../components/ui/PreviewNotice'
import { Table, TD, TH, THead, TR } from '../../../../components/ui/Table'
import { adminData } from '../../../../lib/adminData'
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

      {order.needsInstaller ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border-2 border-accent bg-accent/10 p-3">
          <span className="text-lg" aria-hidden="true">
            🔧
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-fg">العميل طالب فني تركيب</p>
            <p className="text-xs text-muted">كلّمه واتفق على معاد وسعر التركيب قبل الشحن. عنوانه وملاحظاته في كارت العميل.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="الأصناف">
            {/* الموبايل: سطر لكل صنف بدل جدول بسكرول جانبي */}
            <ul className="divide-y divide-border md:hidden">
              {order.items.map((item, index) => (
                <li key={index} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{item.productNameAr}</p>
                    <p className="text-xs text-muted">
                      {formatLength(item.lengthCm)} × {formatPiastres(item.unitPricePiastres)} للمتر
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-fg">{formatPiastres(item.lineTotalPiastres)}</p>
                </li>
              ))}
            </ul>

            <Table className="hidden border-0 md:block">
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

          <OrderNotes
            orderId={order.id}
            notes={order.internalNotes ?? ''}
            expectedUpdatedAt={order.updatedAt}
          />
        </div>

        <div className="order-first space-y-5 xl:order-none">
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

          <OrderStatusControls
            orderId={order.id}
            status={order.status}
            expectedUpdatedAt={order.updatedAt}
          />

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
