import { formatDate, formatDateTime } from '../../lib/format'
import { formatMetersAndCm, formatPiastresExact } from '../../lib/inventory/money'
import type { OpeningDetail } from '../../lib/inventory/openings'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Field'
import { Table, TD, TH, THead, TR } from '../ui/Table'
import { DocStatusBadge, LotStatusBadge } from './InvStatusBadge'
import { OpeningTotalsList } from './OpeningPanels'
import { VoidPurchaseAction } from './VoidPurchaseAction'

/**
 * عرض بس لرصيد أول مدة مرحّل أو مُبطَل أو مستبعَد (من zell_inv_get_opening بالـsnapshots).
 * الإبطال للمرحّل بس. التكلفة التقديرية متعلّمة على البند والدفعة.
 */
export function OpeningView({ detail }: { detail: OpeningDetail }) {
  const { header, lines, lots } = detail

  return (
    <div className="space-y-4">
      <Card title={header.docNo} actions={<DocStatusBadge status={header.status} />}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Fact label="تاريخ الرصيد" value={formatDate(header.asOfDate)} />
          <Fact label="المخزن" value={header.locationName} />
          {header.postedAt ? <Fact label="اترحّل" value={formatDateTime(header.postedAt)} /> : null}
          {header.voidedAt ? <Fact label="اتبطل" value={formatDateTime(header.voidedAt)} /> : null}
          {header.discardedAt ? <Fact label="اتستبعد" value={formatDateTime(header.discardedAt)} /> : null}
        </dl>
        {header.voidReason ? <p className="mt-3 text-xs text-fg">سبب الإبطال: {header.voidReason}</p> : null}
        {header.discardReason ? <p className="mt-3 text-xs text-fg">سبب الاستبعاد: {header.discardReason}</p> : null}
        {header.note ? <p className="mt-3 whitespace-pre-line text-xs text-muted">{header.note}</p> : null}
        <div className="mt-4">
          <OpeningTotalsList itemsTotalPiastres={header.itemsTotalPiastres} estimatedTotalPiastres={header.estimatedTotalPiastres} />
        </div>
        {header.status === 'posted' ? (
          <div className="mt-4 border-t border-border pt-4">
            <VoidPurchaseAction kind="opening" docId={header.docId} docNo={header.docNo} version={header.version} />
          </div>
        ) : null}
      </Card>

      {lines.length > 0 ? (
        <Card title="البنود">
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>المنتج</TH>
                <TH>الكمية</TH>
                <TH>التكلفة</TH>
              </TR>
            </THead>
            <tbody>
              {lines.map((line) => (
                <TR key={line.lineId}>
                  <TD>{line.lineNo}</TD>
                  <TD>
                    <span className="font-semibold">{line.productName}</span>
                    {line.kind === 'roll' && line.widthCm !== null ? <span className="text-muted"> · عرض {line.widthCm} سم</span> : null}
                    {line.costIsEstimated ? (
                      <span className="block text-xs text-muted">
                        <Badge tone="warn">تقديري</Badge> {line.estimateNote}
                      </span>
                    ) : null}
                    {line.zeroCostReason ? <span className="block text-xs text-muted">تكلفة صفر: {line.zeroCostReason}</span> : null}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {line.kind === 'roll'
                      ? String(line.rollCount ?? 0) + ' لفّة · ' + (line.totalLengthCm !== null ? formatMetersAndCm(line.totalLengthCm) : '—')
                      : String(line.quantity ?? 0) + ' قطعة'}
                  </TD>
                  <TD className="whitespace-nowrap font-semibold">{formatPiastresExact(line.lineTotalPiastres)}</TD>
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
                <TH>التكلفة</TH>
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
                  <TD className="whitespace-nowrap font-semibold">
                    {formatPiastresExact(lot.landedCostPiastres)}
                    {lot.costIsEstimated ? <span className="ms-1 text-xs font-normal text-muted">(تقديري)</span> : null}
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
