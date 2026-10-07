import { DOC_STATUS_LABELS, LOT_STATUS_LABELS, type InventoryDocStatus, type InventoryLotStatus } from '../../lib/inventory/labels'
import { Badge, type BadgeTone } from '../ui/Badge'

const DOC_TONES: Readonly<Record<InventoryDocStatus, BadgeTone>> = {
  draft: 'warn',
  posted: 'ok',
  discarded: 'neutral',
  voided: 'danger',
}

/** حالة المستند بالمصطلحات الثابتة: مسودة / مرحّل / مستبعَد (مسودة) / مُبطَل. */
export function DocStatusBadge({ status }: { status: InventoryDocStatus }) {
  return <Badge tone={DOC_TONES[status]}>{DOC_STATUS_LABELS[status]}</Badge>
}

/** حالة الدفعة: فعّالة / مُبطَلة. */
export function LotStatusBadge({ status }: { status: InventoryLotStatus }) {
  return <Badge tone={status === 'active' ? 'ok' : 'danger'}>{LOT_STATUS_LABELS[status]}</Badge>
}
