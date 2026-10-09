import { Badge, type BadgeTone } from '../ui/Badge'
import { ORDER_STATUS_LABELS, type OrderStatus } from '../../lib/enums'

const TONES: Record<OrderStatus, BadgeTone> = {
  new: 'warn',
  confirmed: 'info',
  preparing: 'info',
  shipped: 'info',
  delivered: 'ok',
  refused: 'danger',
  cancelled: 'danger',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>
}
