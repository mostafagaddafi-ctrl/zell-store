import { formatPiastresExact } from '../../lib/inventory/money'
import type { OpeningPreview } from '../../lib/inventory/openings'
import { Table, TD, TH, THead, TR } from '../ui/Table'

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

/** نتيجة zell_inv_preview_opening: تكلفة كل دفعة (مفيش توزيع مصاريف ولا خصم في رصيد أول المدة). */
export function OpeningPreviewPanel({ preview }: { preview: OpeningPreview }) {
  return (
    <div className="space-y-3">
      <OpeningTotalsList itemsTotalPiastres={preview.totals.itemsTotalPiastres} estimatedTotalPiastres={preview.totals.estimatedTotalPiastres} />
      <Table>
        <THead>
          <TR>
            <TH>البند</TH>
            <TH>الدفعة</TH>
            <TH>التكلفة</TH>
          </TR>
        </THead>
        <tbody>
          {preview.lots.map((lot) => (
            <TR key={String(lot.lineNo) + ':' + String(lot.lotSequence)}>
              <TD>{lot.lineNo}</TD>
              <TD>{lot.lotSequence}</TD>
              <TD className="whitespace-nowrap font-semibold">{formatPiastresExact(lot.landedCostPiastres)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
