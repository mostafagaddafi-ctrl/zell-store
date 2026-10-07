import { formatPiastresExact } from '../../lib/inventory/money'
import type { PurchaseTotals } from '../../lib/inventory/purchases'

/** الإجماليات (من الداتابيز أو من المسودة). */
export function PurchaseTotalsList({ totals }: { totals: PurchaseTotals }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
      <Item label="إجمالي البنود" value={formatPiastresExact(totals.itemsSubtotalPiastres)} />
      <Item label="المصاريف الإضافية" value={formatPiastresExact(totals.extrasTotalPiastres)} />
      <Item label="خصم المورد" value={formatPiastresExact(totals.supplierDiscountPiastres)} />
      <Item label="إجمالي التكلفة" value={formatPiastresExact(totals.totalCostPiastres)} strong />
    </dl>
  )
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? 'font-bold text-fg' : 'font-semibold text-fg'} dir="ltr">
        {value}
      </dd>
    </div>
  )
}
