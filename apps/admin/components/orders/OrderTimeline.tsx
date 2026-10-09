import { STATUS_LABELS } from '@zell/core'
import { BEFORE_LOG_MESSAGE, actorLabel, describeEvent, formatCairoDateTime, type OrderEvent } from '../../lib/orders/cycle'
import { Card } from '../ui/Field'

/**
 * 0021-A A2 — سجل الطلب (order_events) من الأحدث للأقدم. الأوردرات القديمة من غير backfill: «قبل السجل».
 * الأسماء من @zell/core، ووقت الحدث بتوقيت القاهرة.
 */
const labels = STATUS_LABELS as Readonly<Record<string, string>>

function statusLabel(status: string): string {
  return labels[status] ?? status
}

export function OrderTimeline({ events }: { events: OrderEvent[] | null }) {
  const beforeLog = events !== null && !events.some((event) => event.kind === 'created')
  return (
    <Card title="سجل الطلب">
      {events === null ? (
        <p className="text-xs text-danger">السجل مش متاح دلوقتي. اعمل تحديث للصفحة.</p>
      ) : (
        <ol className="space-y-2.5">
          {events.map((event) => {
            const line = describeEvent(event, statusLabel)
            return (
              <li key={event.id} className="border-s-2 border-border ps-3">
                <p className="text-sm font-medium text-fg">{line.title}</p>
                {line.detail !== null ? <p className="text-xs text-muted">{line.detail}</p> : null}
                <p className="text-[11px] text-muted">
                  {formatCairoDateTime(event.createdAt)} · {actorLabel(event.actor)}
                </p>
              </li>
            )
          })}
        </ol>
      )}
      {beforeLog ? <p className="mt-2 text-xs text-muted">{BEFORE_LOG_MESSAGE}</p> : null}
    </Card>
  )
}
