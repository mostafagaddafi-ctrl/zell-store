'use client'

import { useId, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { CatalogProduct } from '../../lib/inventory/catalog'
import { summarizeLine, type LineIssue } from '../../lib/inventory/lineIssues'
import { formatMetersAndCm, formatPiastresExact, parseMeters, parsePounds } from '../../lib/inventory/money'
import { costPerMeter, costPerPiece, type LineCosts } from '../../lib/inventory/pricing'
import { PURCHASE_LIMITS, type LineForm } from '../../lib/inventory/purchaseForm'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { Field, inputClasses } from '../ui/Field'
import { CollapsibleSection } from './CollapsibleSection'
import { LotCostTable, SalePriceNote, lotRowsFromCosts, priceText } from './LineCostSummary'
import { ProductPicker } from './ProductPicker'

/**
 * كارت بند واحد بيتفتح ويتقفل. الملخص (والكارت مقفول): المنتج، النوع، اللفّات/الكمية، الإجمالي، تكلفة
 * المتر/القطعة التقريبية، وسعر البيع الحالي. لو فيه مشكلة ظاهرة: علامة + نص الخطأ (مش لون بس).
 * كل خانة عليها data-field عشان المحرّر يعمل focus على أول خانة غلط.
 */
export function InventoryLineCard({
  line,
  index,
  kind,
  products,
  catalog,
  open,
  onToggle,
  onChange,
  onRemove,
  disabled,
  issue,
  costs,
  totalLabel,
  extra,
  newKey,
}: {
  line: LineForm
  index: number
  kind: 'purchase' | 'opening'
  products: readonly CatalogProduct[]
  catalog: ReadonlyMap<number, CatalogProduct>
  open: boolean
  onToggle: () => void
  onChange: (line: LineForm) => void
  onRemove: () => void
  disabled: boolean
  issue: LineIssue | null
  costs: LineCosts | null
  totalLabel: string
  extra?: ReactNode
  newKey: () => string
}) {
  const bodyId = useId()
  const summary = summarizeLine(line, catalog)
  const total = parsePounds(line.total, { name: '', allowZero: true, required: true })
  const zero = total.ok && total.value === 0
  const product = summary.productId === null ? undefined : catalog.get(summary.productId)
  const shortTotal = kind === 'purchase' ? 'إجمالي الشراء' : 'إجمالي التكلفة'

  const rollLengths = line.kind === 'roll' ? line.rolls.map((roll) => ((r) => (r.ok ? r.value : null))(parseMeters(roll.meters, ''))) : []
  const firstBadRoll = Math.max(rollLengths.findIndex((length) => length === null), 0)
  const finalPerUnit =
    costs && summary.measure !== null
      ? line.kind === 'roll'
        ? costPerMeter(costs.landedTotalPiastres, summary.measure)
        : costPerPiece(costs.landedTotalPiastres, summary.measure)
      : null

  return (
    <div data-line-key={line.key} className={cn('rounded-lg border', issue ? 'border-danger' : 'border-border')}>
      <div className="flex items-start gap-2 p-3">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} className="min-w-0 flex-1 text-start">
          <p className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
            <span className="break-words">
              بند {index + 1} · {summary.kindLabel} · {summary.productName ?? 'لسه مااخترتش منتج'}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted">
            {summary.amountText} · {shortTotal}: {summary.totalPiastres === null ? '—' : formatPiastresExact(summary.totalPiastres)} ·
            {' تكلفة ال' + summary.unitLabel + ' (تقريبي): '}
            {priceText(summary.unitCostPiastres, summary.unitLabel)} · سعر البيع الحالي:{' '}
            {summary.salePrice ? priceText(summary.salePrice.pricePiastres, summary.unitLabel) : '—'}
          </p>
          {issue ? (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-danger">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>خطأ: {issue.message}</span>
            </p>
          ) : null}
        </button>
        <Button variant="ghost" size="sm" aria-label={'شيل بند ' + String(index + 1)} disabled={disabled} onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div id={bodyId} hidden={!open} className="space-y-3 border-t border-border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <ProductPicker
            id={'line-product-' + line.key}
            label={line.kind === 'roll' ? 'المنتج (بالمتر)' : 'المنتج (بالعدد)'}
            products={products}
            unit={line.kind === 'roll' ? 'meter' : 'piece'}
            value={line.productId}
            disabled={disabled}
            invalid={issue?.field === 'product'}
            onChange={(productId) => {
              if (line.kind === 'roll') {
                const next = catalog.get(Number(productId))
                const only = next && next.allowedWidthsCm.length === 1 ? String(next.allowedWidthsCm[0]) : ''
                onChange({ ...line, productId, widthCm: only })
              } else onChange({ ...line, productId })
            }}
          />
          {line.kind === 'roll' ? (
            <Field htmlFor={'line-width-' + line.key} label="العرض (سم)" hint="العرض الأساسي أو عرض إضافي فعّال">
              <select
                id={'line-width-' + line.key}
                data-field="width"
                value={line.widthCm}
                disabled={disabled || !product}
                onChange={(event) => onChange({ ...line, widthCm: event.target.value })}
                className={inputClasses}
              >
                <option value="">اختار العرض</option>
                {(product ? product.allowedWidthsCm : []).map((width) => (
                  <option key={width} value={String(width)}>
                    {width} سم
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field htmlFor={'line-qty-' + line.key} label="الكمية" hint="عدد صحيح">
              <input
                id={'line-qty-' + line.key}
                data-field="quantity"
                dir="ltr"
                inputMode="numeric"
                value={line.quantity}
                disabled={disabled}
                onChange={(event) => onChange({ ...line, quantity: event.target.value })}
                className={inputClasses}
              />
            </Field>
          )}
        </div>

        {line.kind === 'roll' ? (
          <CollapsibleSection
            title="اللفّات (كل رول بطوله بالمتر)"
            summary={summary.amountText}
            forceOpen={issue?.field === 'rolls'}
          >
            {line.rolls.map((roll, rollIndex) => {
              const length = rollLengths[rollIndex] ?? null
              const parsed = parseMeters(roll.meters, '')
              return (
                <div key={roll.key} className="flex flex-wrap items-center gap-2">
                  <span className="w-14 text-xs text-muted">لفّة {rollIndex + 1}</span>
                  <input
                    aria-label={'طول لفّة ' + String(rollIndex + 1) + ' بالمتر'}
                    data-field={rollIndex === firstBadRoll ? 'rolls' : undefined}
                    dir="ltr"
                    inputMode="decimal"
                    value={roll.meters}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange({
                        ...line,
                        rolls: line.rolls.map((current, i) => (i === rollIndex ? { ...current, meters: event.target.value } : current)),
                      })
                    }
                    className={inputClasses + ' w-32'}
                  />
                  <span className="text-xs text-muted">
                    {roll.meters.trim() === '' ? 'متر' : length !== null ? formatMetersAndCm(length) : parsed.ok ? '' : parsed.message}
                  </span>
                  {line.rolls.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={'شيل لفّة ' + String(rollIndex + 1)}
                      disabled={disabled}
                      onClick={() => onChange({ ...line, rolls: line.rolls.filter((_r, i) => i !== rollIndex) })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              )
            })}
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || line.rolls.length >= PURCHASE_LIMITS.rollsPerLine}
              onClick={() => onChange({ ...line, rolls: [...line.rolls, { key: newKey(), meters: '' }] })}
            >
              <Plus className="h-3.5 w-3.5" />
              لفّة
            </Button>
          </CollapsibleSection>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor={'line-total-' + line.key} label={totalLabel} hint="رقم بالإنجليزي وبحد أقصى قرشين">
            <input
              id={'line-total-' + line.key}
              data-field="total"
              dir="ltr"
              inputMode="decimal"
              value={line.total}
              disabled={disabled}
              onChange={(event) => onChange({ ...line, total: event.target.value })}
              className={inputClasses}
            />
          </Field>
          {zero ? (
            <Field htmlFor={'line-zero-' + line.key} label="سبب التكلفة الصفر" hint="إجباري للبند اللي تكلفته صفر · من 3 لـ 200 حرف">
              <input
                id={'line-zero-' + line.key}
                data-field="zeroReason"
                value={line.zeroCostReason}
                maxLength={PURCHASE_LIMITS.zeroReasonMax + 20}
                disabled={disabled}
                onChange={(event) => onChange({ ...line, zeroCostReason: event.target.value })}
                className={inputClasses}
              />
            </Field>
          ) : null}
        </div>

        {extra}

        <div className="space-y-2 rounded bg-bg/60 p-2.5">
          <p className="text-xs text-fg">
            {'تكلفة ال' + summary.unitLabel + ' من الإجمالي (تقريبي): '}
            <span className="font-semibold" dir="ltr">
              {priceText(summary.unitCostPiastres, summary.unitLabel)}
            </span>
          </p>
          <SalePriceNote salePrice={summary.salePrice} productId={summary.productId} />
          {costs ? (
            <>
              <p className="text-xs text-fg">
                {'التكلفة النهائية لل' + summary.unitLabel + ' بعد التوزيع (تقريبي): '}
                <span className="font-semibold" dir="ltr">
                  {priceText(finalPerUnit, summary.unitLabel)}
                </span>
              </p>
              <LotCostTable
                rows={lotRowsFromCosts(costs, line.kind, rollLengths, line.kind === 'batch' ? summary.measure : null)}
                unitLabel={summary.unitLabel}
                showAllocations={kind === 'purchase'}
              />
            </>
          ) : (
            <p className="text-xs text-muted">
              اضغط «معاينة التكلفة» عشان تشوف تكلفة كل رول/دفعة{kind === 'purchase' ? ' بعد توزيع المصاريف والخصم' : ''}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
