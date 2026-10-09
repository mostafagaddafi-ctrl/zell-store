import { FOLLOW_UP_FILTER_LABELS, followUpBucket, formatCairoShort } from '../../lib/orders/cycle'
import type { OrderStatus } from '../../lib/enums'
import { Badge, type BadgeTone } from '../ui/Badge'

/** 0021-A A2 — علامة موعد المتابعة في قائمة الطلبات (للطلبات الجديدة فقط). */
const TONES = { overdue: 'danger', today: 'warn', upcoming: 'neutral' } as const satisfies Record<string, BadgeTone>

export function FollowUpBadge({ at, status, now, className }: { at: string | null; status: OrderStatus; now: number; className?: string }) {
  const bucket = followUpBucket(at, status, now)
  if (bucket === null || at === null) return null
  return (
    <Badge tone={TONES[bucket]} className={className}>
      {FOLLOW_UP_FILTER_LABELS[bucket] + ' · ' + formatCairoShort(at)}
    </Badge>
  )
}
