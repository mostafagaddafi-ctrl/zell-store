import { formatMetersAndCm, formatPiastresExact } from '../../lib/inventory/money'
import { costPerMeter, costPerPiece, type LineCosts, type SalePrice } from '../../lib/inventory/pricing'
import { Table, TD, TH, THead, TR } from '../ui/Table'

/**
 * عرض التكاليف (للعرض بس — الداتابيز هي اللي بتحسب الأرقام المعتمدة):
 *   • تكلفة المتر/القطعة التقريبية من الإجمالي (أعداد صحيحة، لأقرب قرش).
 *   • تكلفة كل رول/دفعة والتوزيع النهائي من preview_* أو من دفعات المستند المرحّل بس.
 *   • سعر البيع الحالي **مرجعية** — بيتعدّل من صفحة المنتج بس. مفيش «ربح» ولا «هامش» هنا.
 */

export function priceText(piastres: number | null, unitLabel: string): string {
  return piastres === null ? '—' : formatPiastresExact(piastres) + ' / ' + unitLabel
}

export function SalePriceNote({
  salePrice,
  productId,
  postedView = false,
}: {
  salePrice: SalePrice | null
  productId: number | null
  postedView?: boolean
}) {
  return (
    <div className="text-xs text-muted">
      <span>
        سعر البيع الحالي{postedView ? ' (دلوقتي، مش وقت الترحيل)' : ''}:{' '}
        <span className="font-semibold text-fg" dir="ltr">
          {salePrice ? priceText(salePrice.pricePiastres, salePrice.unit === 'meter' ? 'متر' : 'قطعة') : '—'}
        </span>
        {salePrice && salePrice.widthCm !== null ? ' (عرض ' + String(salePrice.widthCm) + ' سم)' : ''}
      </span>
      {productId !== null ? (
        <a
          href={'/products/' + String(productId)}
          target="_blank"
          rel="noopener noreferrer"
          className="ms-2 font-semibold text-brand hover:underline"
        >
          تعديل السعر من صفحة المنتج
        </a>
      ) : null}
    </div>
  )
}

export type LotCostRow = {
  key: string
  label: string
  measureText: string
  base: number
  extras: number
  discount: number
  landed: number
  perUnit: number | null
}

export function LotCostTable({
  rows,
  unitLabel,
  showAllocations,
}: {
  rows: readonly LotCostRow[]
  unitLabel: 'متر' | 'قطعة'
  showAllocations: boolean
}) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>الدفعة</TH>
          <TH>الكمية</TH>
          <TH>التكلفة الأساسية</TH>
          {showAllocations ? <TH>+ مصاريف موزّعة</TH> : null}
          {showAllocations ? <TH>− خصم موزّع</TH> : null}
          <TH>التكلفة النهائية</TH>
          <TH>{'النهائية لل' + unitLabel + ' (تقريبي)'}</TH>
        </TR>
      </THead>
      <tbody>
        {rows.map((row) => (
          <TR key={row.key}>
            <TD>{row.label}</TD>
            <TD className="whitespace-nowrap">{row.measureText}</TD>
            <TD className="whitespace-nowrap">{formatPiastresExact(row.base)}</TD>
            {showAllocations ? <TD className="whitespace-nowrap">{formatPiastresExact(row.extras)}</TD> : null}
            {showAllocations ? <TD className="whitespace-nowrap">{formatPiastresExact(row.discount)}</TD> : null}
            <TD className="whitespace-nowrap font-semibold">{formatPiastresExact(row.landed)}</TD>
            <TD className="whitespace-nowrap">{priceText(row.perUnit, unitLabel)}</TD>
          </TR>
        ))}
      </tbody>
    </Table>
  )
}

/** صفوف جدول الدفعات لبند من نتيجة المعاينة: اللفّة n بطولها، أو دفعة القطع بكميتها. */
export function lotRowsFromCosts(
  costs: LineCosts,
  kind: 'roll' | 'batch',
  rollLengthsCm: readonly (number | null)[],
  quantity: number | null,
): LotCostRow[] {
  return costs.lots.map((lot) => {
    const length = kind === 'roll' ? (rollLengthsCm[lot.lotSequence - 1] ?? null) : null
    return {
      key: String(lot.lotSequence),
      label: kind === 'roll' ? 'لفّة ' + String(lot.lotSequence) : 'الدفعة',
      measureText: kind === 'roll' ? (length !== null ? formatMetersAndCm(length) : '—') : quantity !== null ? String(quantity) + ' قطعة' : '—',
      base: lot.baseCostPiastres,
      extras: lot.allocatedExtrasPiastres,
      discount: lot.allocatedDiscountPiastres,
      landed: lot.landedCostPiastres,
      perUnit:
        kind === 'roll'
          ? length !== null
            ? costPerMeter(lot.landedCostPiastres, length)
            : null
          : quantity !== null
            ? costPerPiece(lot.landedCostPiastres, quantity)
            : null,
    }
  })
}
