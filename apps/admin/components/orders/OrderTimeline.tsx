import { ADMIN_STATUS_LABELS, TIMELINE_TEXT, actorLabel, describeEvent, formatCairoDateTime, type OrderEvent } from '../../lib/orders/cycle'
import { Card } from '../ui/Field'

/**
 * 0021-A A2 — سجل الطلب (order_events) من الأحدث للأقدم، بتوقيت القاهرة. الأوردرات القديمة من غير backfill.
 * مفيش أي كود داخلي ولا JSON خام بيظهر: النصوص من describeEvent بس.
 */
const labels = ADMIN_STATUS_LABELS as Readonly<Record<string, string>>

function statusLabel(status: string): string | null {
  return labels[status] ?? null
}

export function OrderTimeline({ events }: { events: OrderEvent[] | null }) {
  const beforeLog = events !== null && !events.some((event) => event.kind === 'created')
  return (
    <Card title={TIMELINE_TEXT.title}>
      {events === null ? (
        <p className="text-xs text-danger">{TIMELINE_TEXT.unavailable}</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted">{TIMELINE_TEXT.empty}</p>
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
      {beforeLog ? <p className="mt-2 border-s-2 border-border ps-3 text-xs text-muted">{TIMELINE_TEXT.beforeLog}</p> : null}
    </Card>
  )
}
