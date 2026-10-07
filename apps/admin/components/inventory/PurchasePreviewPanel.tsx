import { formatPiastresExact } from '../../lib/inventory/money'
import type { PurchasePreview, PurchaseTotals } from '../../lib/inventory/purchases'
import { Table, TD, TH, THead, TR } from '../ui/Table'

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

/**
 * نتيجة zell_inv_preview_purchase: تكلفة كل دفعة (لفّة أو بند قطع) بعد توزيع المصاريف والخصم.
 * الحساب كله في الداتابيز — الواجهة بتعرض بس.
 */
export function PurchasePreviewPanel({ preview }: { preview: PurchasePreview }) {
  return (
    <div className="space-y-3">
      <PurchaseTotalsList totals={preview.totals} />
      <Table>
        <THead>
          <TR>
            <TH>البند</TH>
            <TH>الدفعة</TH>
            <TH>التكلفة الأساسية</TH>
            <TH>+ مصاريف</TH>
            <TH>− خصم</TH>
            <TH>التكلفة النهائية</TH>
          </TR>
        </THead>
        <tbody>
          {preview.lots.map((lot) => (
            <TR key={String(lot.lineNo) + ':' + String(lot.lotSequence)}>
              <TD>{lot.lineNo}</TD>
              <TD>{lot.lotSequence}</TD>
              <TD className="whitespace-nowrap">{formatPiastresExact(lot.baseCostPiastres)}</TD>
              <TD className="whitespace-nowrap">{formatPiastresExact(lot.allocatedExtrasPiastres)}</TD>
              <TD className="whitespace-nowrap">{formatPiastresExact(lot.allocatedDiscountPiastres)}</TD>
              <TD className="whitespace-nowrap font-semibold">{formatPiastresExact(lot.landedCostPiastres)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
