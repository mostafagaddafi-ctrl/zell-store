import { formatDate, formatDateTime } from '../../lib/format'
import { formatMetersAndCm, formatPiastresExact } from '../../lib/inventory/money'
import type { CatalogProduct } from '../../lib/inventory/catalog'
import { catalogById, findSalePrice, perUnitCost } from '../../lib/inventory/pricing'
import { CHARGE_KIND_LABELS } from '../../lib/inventory/purchaseForm'
import type { PurchaseDetail } from '../../lib/inventory/purchases'
import { Card } from '../ui/Field'
import { Table, TD, TH, THead, TR } from '../ui/Table'
import { DocStatusBadge, LotStatusBadge } from './InvStatusBadge'
import { CurrentSalePriceCell, PER_UNIT_COST_LABEL, POSTED_SALE_PRICE_LABEL, priceText } from './LineCostSummary'
import { PurchaseTotalsList } from './PurchasePreviewPanel'
import { VoidPurchaseAction } from './VoidPurchaseAction'

/**
 * عرض بس لفاتورة مرحّلة أو مُبطَلة أو مستبعَدة. البيانات من zell_inv_get_purchase بالـsnapshots
 * (اسم المنتج والعرض والوحدة وقت الترحيل). الإبطال للمرحّل بس.
 * التكلفة للمتر/القطعة تقريبية (أعداد صحيحة لأقرب قرش) من أرقام الداتابيز. سعر البيع **الحالي** مرجعية
 * من قايمة المنتجات دلوقتي (مش لقطة وقت الترحيل) — catalog = null يعني القراءة فشلت فبيتعرض «—».
 */
export function PurchaseView({ detail, catalog }: { detail: PurchaseDetail; catalog: CatalogProduct[] | null }) {
  const { header, lines, charges, lots } = detail
  const products = catalog ? catalogById(catalog) : null

  return (
    <div className="space-y-4">
      <Card title={header.docNo} actions={<DocStatusBadge status={header.status} />}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Fact label="تاريخ الفاتورة" value={formatDate(header.docDate)} />
          <Fact label="المورد" value={header.supplierName ?? 'من غير مورد'} />
          <Fact label="رقم فاتورة المورد" value={header.supplierRef ?? '—'} />
          <Fact label="المخزن" value={header.locationName} />
          {header.postedAt ? <Fact label="اترحّلت" value={formatDateTime(header.postedAt)} /> : null}
          {header.voidedAt ? <Fact label="اتبطلت" value={formatDateTime(header.voidedAt)} /> : null}
          {header.discardedAt ? <Fact label="اتستبعدت" value={formatDateTime(header.discardedAt)} /> : null}
        </dl>
        {header.voidReason ? <p className="mt-3 text-xs text-fg">سبب الإبطال: {header.voidReason}</p> : null}
        {header.discardReason ? <p className="mt-3 text-xs text-fg">سبب الاستبعاد: {header.discardReason}</p> : null}
        {header.note ? <p className="mt-3 whitespace-pre-line text-xs text-muted">{header.note}</p> : null}
        <div className="mt-4">
          <PurchaseTotalsList totals={header} />
        </div>
        {header.status === 'posted' ? (
          <div className="mt-4 border-t border-border pt-4">
            <VoidPurchaseAction docId={header.docId} docNo={header.docNo} version={header.version} />
          </div>
        ) : null}
      </Card>

      {lines.length > 0 ? (
        <Card title="البنود">
          {products === null ? (
            <p className="mb-3 text-xs text-muted">سعر البيع الحالي مش ظاهر: مقدرناش نقرا قايمة المنتجات. حدّث الصفحة.</p>
          ) : null}
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>المنتج</TH>
                <TH>الكمية</TH>
                <TH>الإجمالي</TH>
                <TH>+ مصاريف</TH>
                <TH>− خصم</TH>
                <TH>التكلفة النهائية</TH>
                <TH>{PER_UNIT_COST_LABEL}</TH>
                <TH>{POSTED_SALE_PRICE_LABEL}</TH>
              </TR>
            </THead>
            <tbody>
              {lines.map((line) => (
                <TR key={line.lineId}>
                  <TD>{line.lineNo}</TD>
                  <TD>
                    <span className="font-semibold">{line.productName}</span>
                    {line.kind === 'roll' && line.widthCm !== null ? <span className="text-muted"> · عرض {line.widthCm} سم</span> : null}
                    {line.zeroCostReason ? <span className="block text-xs text-muted">تكلفة صفر: {line.zeroCostReason}</span> : null}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {line.kind === 'roll'
                      ? String(line.rollCount ?? 0) + ' لفّة · ' + (line.totalLengthCm !== null ? formatMetersAndCm(line.totalLengthCm) : '—')
                      : String(line.quantity ?? 0) + ' قطعة'}
                  </TD>
                  <TD className="whitespace-nowrap">{formatPiastresExact(line.lineTotalPiastres)}</TD>
                  <TD className="whitespace-nowrap">{formatPiastresExact(line.allocatedExtrasPiastres)}</TD>
                  <TD className="whitespace-nowrap">{formatPiastresExact(line.allocatedDiscountPiastres)}</TD>
                  <TD className="whitespace-nowrap font-semibold">{formatPiastresExact(line.landedTotalPiastres)}</TD>
                  <TD className="whitespace-nowrap">
                    {priceText(
                      perUnitCost(line.kind, line.landedTotalPiastres, line.totalLengthCm, line.quantity),
                      line.kind === 'roll' ? 'متر' : 'قطعة',
                    )}
                  </TD>
                  <TD>
                    <CurrentSalePriceCell salePrice={findSalePrice(products, line.productId, line.widthCm)} productId={line.productId} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {charges.length > 0 ? (
        <Card title="المصاريف الإضافية">
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>النوع</TH>
                <TH>المبلغ</TH>
                <TH>المرجع</TH>
                <TH>ملاحظة</TH>
              </TR>
            </THead>
            <tbody>
              {charges.map((charge) => (
                <TR key={charge.chargeNo}>
                  <TD>{charge.chargeNo}</TD>
                  <TD>{CHARGE_KIND_LABELS[charge.kind]}</TD>
                  <TD className="whitespace-nowrap">{formatPiastresExact(charge.amountPiastres)}</TD>
                  <TD>{charge.reference ?? '—'}</TD>
                  <TD>{charge.note ?? '—'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {lots.length > 0 ? (
        <Card title="الدفعات (كل لفّة دفعة، وكل بند قطع دفعة)">
          <Table>
            <THead>
              <TR>
                <TH>كود الدفعة</TH>
                <TH>البند</TH>
                <TH>الكمية</TH>
                <TH>التكلفة الأساسية</TH>
                <TH>+ مصاريف</TH>
                <TH>− خصم</TH>
                <TH>التكلفة النهائية</TH>
                <TH>{PER_UNIT_COST_LABEL}</TH>
                <TH>الحالة</TH>
              </TR>
            </THead>
            <tbody>
              {lots.map((lot) => (
                <TR key={lot.lotId}>
                  <TD>
                    <bdi dir="ltr" className="font-mono text-xs">
                      {lot.lotCode}
                    </bdi>
                  </TD>
                  <TD>
                    {lot.lineNo} · {lot.lotSequence}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {lot.lotKind === 'roll'
                      ? (lot.initialLengthCm !== null ? formatMetersAndCm(lot.initialLengthCm) : '—') +
                        (lot.widthCm !== null ? ' · عرض ' + String(lot.widthCm) + ' سم' : '')
                      : String(lot.initialQuantity ?? 0) + ' قطعة'}
                  </TD>
                  <TD className="whitespace-nowrap">{formatPiastresExact(lot.baseCostPiastres)}</TD>
                  <TD className="whitespace-nowrap">{formatPiastresExact(lot.allocatedExtrasPiastres)}</TD>
                  <TD className="whitespace-nowrap">{formatPiastresExact(lot.allocatedDiscountPiastres)}</TD>
                  <TD className="whitespace-nowrap font-semibold">{formatPiastresExact(lot.landedCostPiastres)}</TD>
                  <TD className="whitespace-nowrap">
                    {priceText(
                      perUnitCost(lot.lotKind, lot.landedCostPiastres, lot.initialLengthCm, lot.initialQuantity),
                      lot.lotKind === 'roll' ? 'متر' : 'قطعة',
                    )}
                  </TD>
                  <TD>
                    <LotStatusBadge status={lot.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="break-words font-semibold text-fg">{value}</dd>
    </div>
  )
}
