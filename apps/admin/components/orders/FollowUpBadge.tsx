import { FOLLOW_UP_FILTER_LABELS, followUpBucket, formatCairoDateTime } from '../../lib/orders/cycle'
import type { OrderStatus } from '../../lib/enums'
import { Badge, type BadgeTone } from '../ui/Badge'

/** 0021-A A2 — علامة معاد المتابعة في قايمة الطلبات (للطلبات الجديدة بس). */
const TONES = { overdue: 'danger', today: 'warn', upcoming: 'neutral' } as const satisfies Record<string, BadgeTone>

export function FollowUpBadge({ at, status, now, className }: { at: string | null; status: OrderStatus; now: number; className?: string }) {
  const bucket = followUpBucket(at, status, now)
  if (bucket === null || at === null) return null
  return (
    <Badge tone={TONES[bucket]} className={className}>
      {FOLLOW_UP_FILTER_LABELS[bucket] + ' · ' + formatCairoDateTime(at)}
    </Badge>
  )
}
