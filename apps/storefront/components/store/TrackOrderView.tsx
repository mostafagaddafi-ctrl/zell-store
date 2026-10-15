import type { ReactNode } from 'react'
import { AlertCircle, ExternalLink, MessageCircle, Truck } from 'lucide-react'
import { CUSTOMER_STATUS_LABELS, formatPiastres, preferredDeliveryLine } from '@zell/core'
import { customerStatusLabel, trackDeliveryView, trackItemSpec, type TrackedOrder } from '../../lib/orders/trackOrder'
import {
  trackEta,
  trackMoneyLines,
  trackNextStep,
  trackShippingView,
  trackStages,
  trackTime,
  type TrackMoneyLine,
} from '../../lib/orders/trackView'
import { buttonClasses } from '../ui/Button'
import { Num } from './Num'
import { TrackTimeline } from './TrackTimeline'

/**
 * TRACK-ORDER v2 W2-A — نتيجة «تتبّع طلبك» (العقد docs/contracts/TRACK-ORDER-v2.md §٢ – §٩ و§١٧-١).
 *
 *   • الحالة والخطوة التالية · بانر الإلغاء/الرفض · خط المراحل · الموعد · الشحن والشحنة · رسايل المتجر ·
 *     بيانات التوصيل · المنتجات · الحساب · زرار واتساب.
 *   • الرسايل بتتعرض كنص (React بيهرّب أي HTML)، ورابط الشحنة https بس وبيفتح noopener noreferrer.
 *   • كل البيانات جاية من الحارس (parseTrackedOrder) — مفيش أي حاجة من رد الداتابيز بتتمرّر زي ما هي.
 */

const TIME_ZONE = 'Africa/Cairo'

export function TrackOrderView({ order, whatsappHref }: { order: TrackedOrder; whatsappHref: string | null }) {
  const timeline = trackStages(order)
  const next = trackNextStep(order)
  const eta = trackEta(order)
  const preferred = order.confirmedDelivery === null && order.delivery?.kind === 'preferred' ? trackDeliveryView(order.delivery) : null
  const shipping = trackShippingView(order)
  const money = trackMoneyLines(order)
  const shipment = order.shipment

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs text-muted">حالة الطلب</p>
        <p className="mt-1 text-lg font-bold text-fg">{customerStatusLabel(order.status)}</p>
        {next !== null ? (
          <p className="mt-2 text-sm leading-relaxed text-fg">
            {next.text}
            {next.remainingPiastres !== null ? (
              <>
                {': '}
                <span className="font-semibold">
                  <Num>{formatPiastres(next.remainingPiastres)}</Num>
                </span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {timeline.banner !== null ? (
        <div role="status" className="flex gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-fg">{CUSTOMER_STATUS_LABELS[timeline.banner.status]}</p>
            {timeline.banner.at !== null ? (
              <p className="text-xs text-muted">
                <Num>{trackTime(timeline.banner.at)}</Num>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="track-stages">
        <h2 id="track-stages" className="mb-4 text-sm font-bold text-fg">
          مراحل الطلب
        </h2>
        <TrackTimeline stages={timeline.stages} />
        {timeline.historyNote !== null ? <p className="mt-4 text-xs text-muted">{timeline.historyNote}</p> : null}
      </section>

      {eta !== null || preferred !== null ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          {eta !== null ? (
            <p className="text-sm font-semibold text-fg">
              <Num>{eta.line}</Num>
            </p>
          ) : null}
          {preferred !== null ? (
            <div>
              {preferred.note !== null ? <p className="text-xs text-muted">{preferred.note}</p> : null}
              <p className="text-sm text-fg">
                <Num>{preferred.line}</Num>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {shipping !== null || shipment !== null ? (
        <section className="space-y-2 rounded-lg border border-border bg-card p-4" aria-labelledby="track-shipping">
          <h2 id="track-shipping" className="flex items-center gap-2 text-sm font-bold text-fg">
            <Truck className="h-4 w-4 text-muted" aria-hidden="true" />
            الشحن
          </h2>
          {shipping !== null ? (
            <p className="text-sm text-fg">
              {shipping.label}
              {shipping.days !== null ? (
                <span className="text-muted">
                  {' · '}
                  <Num>{shipping.days}</Num>
                </span>
              ) : null}
            </p>
          ) : null}
          {shipment !== null ? (
            <dl className="space-y-1 text-sm">
              <Row label="شركة الشحن">{shipment.carrier}</Row>
              {shipment.trackingNumber !== null ? (
                <Row label="رقم الشحنة">
                  <span dir="ltr" className="font-mono">
                    {shipment.trackingNumber}
                  </span>
                </Row>
              ) : null}
              {shipment.shippedOn !== null ? (
                <Row label="تاريخ الشحن">
                  <Num>{preferredDeliveryLine({ date: shipment.shippedOn, period: null, note: null })}</Num>
                </Row>
              ) : null}
            </dl>
          ) : null}
          {shipment !== null && shipment.trackingUrl !== null ? (
            <a
              href={shipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:opacity-70"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              تتبّع الشحنة عند شركة الشحن
            </a>
          ) : null}
        </section>
      ) : null}

      {order.updates.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="track-updates">
          <h2 id="track-updates" className="mb-3 text-sm font-bold text-fg">
            رسايل من المتجر
          </h2>
          <ul className="space-y-3">
            {order.updates.map((update) => (
              <li key={update.id} className="rounded-md bg-bg p-3">
                <p className="whitespace-pre-line text-sm leading-relaxed text-fg">{update.text}</p>
                <p className="mt-1 text-xs text-muted">
                  <Num>{trackTime(update.at)}</Num>
                  {update.edited ? ' · تم التعديل' : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="track-customer">
        <h2 id="track-customer" className="mb-2 text-sm font-bold text-fg">
          بيانات التوصيل
        </h2>
        <dl className="space-y-1 text-sm">
          <Row label="الاسم">{order.customer.name}</Row>
          <Row label="الموبايل">
            <span dir="ltr">
              <Num>{order.customer.phone}</Num>
            </span>
          </Row>
          <Row label="المحافظة">{order.customer.governorate + (order.customer.area !== null ? ' · ' + order.customer.area : '')}</Row>
          <Row label="العنوان">{order.customer.address}</Row>
        </dl>
      </section>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
        <div className="bg-card p-4">
          <dt className="text-xs text-muted">رقم الطلب</dt>
          <dd className="mt-1 font-mono text-sm font-bold text-fg" dir="ltr">
            {order.orderNumber}
          </dd>
        </div>
        <div className="bg-card p-4">
          <dt className="text-xs text-muted">تاريخ الطلب</dt>
          <dd className="mt-1 text-sm font-semibold text-fg">
            <Num>{new Date(order.createdAt).toLocaleDateString('ar-EG', { timeZone: TIME_ZONE })}</Num>
          </dd>
        </div>
      </dl>

      {order.items.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
          {order.items.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-fg">{item.productName}</p>
                <p className="text-xs text-muted">
                  <Num>{trackItemSpec(item)}</Num>
                </p>
              </div>
              <span className="shrink-0 font-semibold text-fg">
                <Num>{formatPiastres(item.lineTotalPiastres)}</Num>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="space-y-2 rounded-lg border border-border bg-card p-4" aria-labelledby="track-money">
        <h2 id="track-money" className="text-sm font-bold text-fg">
          الحساب
        </h2>
        <MoneyLines lines={money.charges} />
        <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-fg">
          <span>الإجمالي</span>
          <span>
            <Num>{formatPiastres(money.totalPiastres)}</Num>
          </span>
        </div>
        <div className="border-t border-border pt-2">
          <MoneyLines lines={money.payments} />
        </div>
      </section>

      {whatsappHref !== null ? (
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={buttonClasses('whatsapp', 'lg')}>
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          كلّمنا على واتساب بخصوص الطلب
        </a>
      ) : null}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted">{label}:</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  )
}

function MoneyLines({ lines }: { lines: TrackMoneyLine[] }) {
  return (
    <dl className="space-y-1 text-sm">
      {lines.map((line) => (
        <div key={line.label} className="flex justify-between gap-3">
          <dt className="text-muted">{line.label}</dt>
          <dd className="font-semibold text-fg">
            <Num>{(line.minus ? '− ' : '') + formatPiastres(line.amountPiastres)}</Num>
          </dd>
        </div>
      ))}
    </dl>
  )
}
