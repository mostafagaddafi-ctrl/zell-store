import { formatPiastresExact } from '../../lib/inventory/money'

/** إجماليات رصيد أول المدة: الكل، ومنهم التقديري. */
export function OpeningTotalsList({ itemsTotalPiastres, estimatedTotalPiastres }: { itemsTotalPiastres: number; estimatedTotalPiastres: number }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
      <div className="min-w-0">
        <dt className="text-muted">إجمالي الرصيد</dt>
        <dd className="font-bold text-fg" dir="ltr">
          {formatPiastresExact(itemsTotalPiastres)}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted">منه تقديري</dt>
        <dd className="font-semibold text-fg" dir="ltr">
          {formatPiastresExact(estimatedTotalPiastres)}
        </dd>
      </div>
    </dl>
  )
}
