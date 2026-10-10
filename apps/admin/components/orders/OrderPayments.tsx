import { formatDateTime, formatPiastres } from '../../lib/format'
import {
  KIND_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TEXT,
  PURPOSE_LABELS,
  canDeliver,
  canRecordPayment,
  canRefund,
  needsRefund,
  renderTemplate,
  whatsappHref,
} from '../../lib/orders/payments'
import type { OrderPaymentsView } from '../../lib/data/orderPayments'
import { buttonClasses } from '../ui/Button'
import { Card } from '../ui/Field'
import { DeliverForm, PaymentEntryForm } from './PaymentForms'

/**
 * 0021-A P2 — كارت «الدفع» في صفحة الطلب: الإجمالي · رسوم التأكيد · المدفوع · الباقي · الحالة · السجل، وتحت منه الفورمات
 * (تسجيل دفعة · التسليم مع التحصيل · الرد للمالك) ورسالة واتساب الجاهزة. البيانات بجلسة المستخدم، وأي فشل = «مش متاح دلوقتي».
 */
export function OrderPaymentsCard({
  view,
  isOwner,
  customerName,
  customerPhone,
  orderNumber,
}: {
  view: OrderPaymentsView
  isOwner: boolean
  customerName: string
  customerPhone: string
  orderNumber: string
}) {
  const { summary, methods, settings } = view
  if (summary === null) {
    return (
      <Card title={PAYMENT_TEXT.title}>
        <p className="text-xs text-muted">{PAYMENT_TEXT.unavailable}</p>
      </Card>
    )
  }
  const template = settings?.whatsappTemplate ?? null
  const message = template === null
    ? ''
    : renderTemplate(template, {
        name: customerName,
        orderNumber,
        total: formatPiastres(summary.totalPiastres),
        fee: formatPiastres(summary.feePiastres),
        remaining: formatPiastres(summary.remainingPiastres),
        paymentNumbers: settings?.paymentNumbers ?? '',
        policy: settings?.feePolicy ?? '',
      })

  return (
    <>
      <Card title={PAYMENT_TEXT.title}>
        <dl className="space-y-1.5 text-sm">
          <Row label={PAYMENT_TEXT.total} value={formatPiastres(summary.totalPiastres)} />
          {summary.feePiastres > 0 ? <Row label={PAYMENT_TEXT.fee} value={formatPiastres(summary.feePiastres)} /> : null}
          <Row label={PAYMENT_TEXT.paid} value={formatPiastres(summary.paidPiastres)} />
          {summary.refundedPiastres > 0 ? <Row label={PAYMENT_TEXT.refunded} value={formatPiastres(summary.refundedPiastres)} /> : null}
          <Row label={PAYMENT_TEXT.remaining} value={formatPiastres(summary.remainingPiastres)} strong />
          <Row label={PAYMENT_TEXT.status} value={PAYMENT_STATUS_LABELS[summary.paymentStatus] + (summary.hasRefund ? ' · ' + PAYMENT_TEXT.hasRefund : '')} />
        </dl>
        {summary.feeDuePiastres > 0 && (summary.status === 'new' || summary.status === 'confirmed') ? (
          <p className="mt-3 rounded border-s-2 border-gold bg-bg p-2 text-xs text-fg">
            {PAYMENT_TEXT.feeRequiredBeforeConfirm + ' ' + PAYMENT_TEXT.feeDue + ': ' + formatPiastres(summary.feeDuePiastres)}
          </p>
        ) : null}
        {needsRefund(summary) ? <p className="mt-3 text-xs font-semibold text-danger">{PAYMENT_TEXT.needsRefund}</p> : null}

        <h3 className="mt-4 text-xs font-bold text-fg">{PAYMENT_TEXT.history}</h3>
        {summary.payments.length === 0 ? (
          <p className="mt-1 text-xs text-muted">{PAYMENT_TEXT.noPayments}</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {summary.payments.map((p) => (
              <li key={p.id} className="py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className={p.kind === 'refund' ? 'font-semibold text-danger' : 'font-semibold text-fg'}>
                    {KIND_LABELS[p.kind] + ' · ' + PURPOSE_LABELS[p.purpose]}
                  </span>
                  <span className="font-semibold text-fg">{(p.kind === 'refund' ? '− ' : '') + formatPiastres(p.amountPiastres)}</span>
                </div>
                <p className="text-muted">
                  {p.methodName + (p.reference ? ' · ' + p.reference : '') + ' · ' + formatDateTime(p.createdAt)}
                </p>
                {p.note ? <p className="text-muted">{p.note}</p> : null}
              </li>
            ))}
          </ul>
        )}

        {template !== null && message.trim() !== '' ? (
          <div className="mt-4">
            <a href={whatsappHref(customerPhone, message)} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm', 'w-full')}>
              {PAYMENT_TEXT.whatsapp}
            </a>
            <p className="mt-1 text-[11px] text-muted">{PAYMENT_TEXT.whatsappHint}</p>
          </div>
        ) : null}
      </Card>

      {methods !== null && canRecordPayment(summary) ? (
        <Card title={PAYMENT_TEXT.record}>
          <PaymentEntryForm mode="payment" summary={summary} methods={methods} />
        </Card>
      ) : null}

      {methods !== null && canDeliver(summary) ? (
        <Card title={PAYMENT_TEXT.deliver}>
          <DeliverForm summary={summary} methods={methods} creditEnabled={settings?.creditEnabled === true} />
        </Card>
      ) : null}

      {isOwner && methods !== null && canRefund(summary) ? (
        <Card title={PAYMENT_TEXT.refund}>
          <PaymentEntryForm mode="refund" summary={summary} methods={methods} />
        </Card>
      ) : null}
    </>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? 'font-bold text-fg' : 'font-medium text-fg'}>{value}</dd>
    </div>
  )
}
