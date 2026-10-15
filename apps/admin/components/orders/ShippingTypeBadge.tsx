import { Zap } from 'lucide-react'
import { cn } from '../../lib/cn'
import { SHIPPING_TYPE_LABELS, type OrderShippingType } from '../../lib/orders/listFilters'

/**
 * EXPRESS-SHIPPING §١٢ — علامة نوع الشحن في قايمة الطلبات، من لقطة الطلب بس.
 * سريع = بارزة بأيقونة برق · عادي = هادية · الطلب القديم (null) = من غير علامة. التمييز بالنص والأيقونة، مش باللون بس.
 */
export function ShippingTypeBadge({ type, className }: { type: OrderShippingType | null; className?: string }) {
  if (type === null) return null
  if (type === 'express') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded border border-gold bg-gold/20 px-1.5 py-0.5 text-[11px] font-bold text-fg',
          className,
        )}
      >
        <Zap className="h-3 w-3 shrink-0 fill-gold text-gold" aria-hidden="true" />
        {SHIPPING_TYPE_LABELS.express}
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center rounded bg-border/40 px-1.5 py-0.5 text-[11px] font-medium text-muted', className)}>
      {SHIPPING_TYPE_LABELS.standard}
    </span>
  )
}
