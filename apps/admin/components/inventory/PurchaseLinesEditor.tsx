'use client'

import { Plus, Trash2 } from 'lucide-react'
import type { CatalogProduct } from '../../lib/inventory/catalog'
import { formatMetersAndCm, parseMeters, parsePounds } from '../../lib/inventory/money'
import {
  PURCHASE_LIMITS,
  newBatchLine,
  newRollLine,
  type BatchLineForm,
  type LineForm,
  type RollLineForm,
} from '../../lib/inventory/purchaseForm'
import { Button } from '../ui/Button'
import { Field, inputClasses } from '../ui/Field'

/**
 * بنود الفاتورة:
 *   • لفّات (منتجات المتر بس): عرض من العروض المسموحة (الأساسي ∪ الفعالة) + لفّة لكل رول بطولها بالمتر.
 *   • قطع (منتجات العدد بس): كمية.
 * الطول بيتكتب بالمتر ويتعرض جنبه بالسنتيمتر. التحقق النهائي في buildPurchasePayload والسيرفر.
 */
export function PurchaseLinesEditor({
  lines,
  onChange,
  catalog,
  disabled,
  newKey,
}: {
  lines: LineForm[]
  onChange: (lines: LineForm[]) => void
  catalog: CatalogProduct[]
  disabled: boolean
  newKey: () => string
}) {
  const meterProducts = catalog.filter((product) => product.saleUnit === 'meter')
  const pieceProducts = catalog.filter((product) => product.saleUnit === 'piece')
  const byId = new Map(catalog.map((product) => [product.id, product]))
  const full = lines.length >= PURCHASE_LIMITS.lines

  function replace(index: number, line: LineForm) {
    onChange(lines.map((current, i) => (i === index ? line : current)))
  }

  function remove(index: number) {
    onChange(lines.filter((_line, i) => i !== index))
  }

  function productLabel(product: CatalogProduct): string {
    return product.nameAr + (product.isActive ? '' : ' (موقوف)')
  }

  function renderTotal(line: LineForm, index: number) {
    const total = parsePounds(line.total, { name: '', allowZero: true, required: true })
    const zero = total.ok && total.value === 0
    return (
      <>
        <Field htmlFor={'line-total-' + line.key} label="إجمالي البند (جنيه)" hint="رقم بالإنجليزي وبحد أقصى قرشين">
          <input
            id={'line-total-' + line.key}
            dir="ltr"
            inputMode="decimal"
            value={line.total}
            disabled={disabled}
            onChange={(event) => replace(index, { ...line, total: event.target.value })}
            className={inputClasses}
          />
        </Field>
        {zero ? (
          <Field htmlFor={'line-zero-' + line.key} label="سبب التكلفة الصفر" hint="إجباري للبند اللي تكلفته صفر · من 3 لـ 200 حرف">
            <input
              id={'line-zero-' + line.key}
              value={line.zeroCostReason}
              maxLength={PURCHASE_LIMITS.zeroReasonMax + 20}
              disabled={disabled}
              onChange={(event) => replace(index, { ...line, zeroCostReason: event.target.value })}
              className={inputClasses}
            />
          </Field>
        ) : null}
      </>
    )
  }

  function renderRoll(line: RollLineForm, index: number) {
    const product = byId.get(Number(line.productId))
    const widths = product && product.saleUnit === 'meter' ? product.allowedWidthsCm : []
    let totalCm = 0
    let allValid = line.rolls.length > 0
    for (const roll of line.rolls) {
      const parsed = parseMeters(roll.meters, '')
      if (parsed.ok) totalCm += parsed.value
      else allValid = false
    }

    return (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor={'line-product-' + line.key} label="المنتج (بالمتر)">
            <select
              id={'line-product-' + line.key}
              value={line.productId}
              disabled={disabled}
              onChange={(event) => {
                const next = byId.get(Number(event.target.value))
                const only = next && next.allowedWidthsCm.length === 1 ? String(next.allowedWidthsCm[0]) : ''
                replace(index, { ...line, productId: event.target.value, widthCm: only })
              }}
              className={inputClasses}
            >
              <option value="">اختار منتج</option>
              {meterProducts.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {productLabel(option)}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor={'line-width-' + line.key} label="العرض (سم)" hint="العرض الأساسي أو عرض إضافي فعّال">
            <select
              id={'line-width-' + line.key}
              value={line.widthCm}
              disabled={disabled || widths.length === 0}
              onChange={(event) => replace(index, { ...line, widthCm: event.target.value })}
              className={inputClasses}
            >
              <option value="">اختار العرض</option>
              {widths.map((width) => (
                <option key={width} value={String(width)}>
                  {width} سم
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg">اللفّات (كل رول بطوله بالمتر)</p>
          {line.rolls.map((roll, rollIndex) => {
            const parsed = parseMeters(roll.meters, '')
            return (
              <div key={roll.key} className="flex flex-wrap items-center gap-2">
                <span className="w-14 text-xs text-muted">لفّة {rollIndex + 1}</span>
                <input
                  aria-label={'طول لفّة ' + String(rollIndex + 1) + ' بالمتر'}
                  dir="ltr"
                  inputMode="decimal"
                  value={roll.meters}
                  disabled={disabled}
                  onChange={(event) =>
                    replace(index, {
                      ...line,
                      rolls: line.rolls.map((current, i) => (i === rollIndex ? { ...current, meters: event.target.value } : current)),
                    })
                  }
                  className={inputClasses + ' w-32'}
                />
                <span className="text-xs text-muted">
                  {roll.meters.trim() === '' ? 'متر' : parsed.ok ? formatMetersAndCm(parsed.value) : parsed.message}
                </span>
                {line.rolls.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={'شيل لفّة ' + String(rollIndex + 1)}
                    disabled={disabled}
                    onClick={() => replace(index, { ...line, rolls: line.rolls.filter((_r, i) => i !== rollIndex) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            )
          })}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || line.rolls.length >= PURCHASE_LIMITS.rollsPerLine}
              onClick={() => replace(index, { ...line, rolls: [...line.rolls, { key: newKey(), meters: '' }] })}
            >
              <Plus className="h-3.5 w-3.5" />
              لفّة
            </Button>
            <span className="text-xs text-muted">
              {line.rolls.length} لفّة{allValid ? ' · الإجمالي ' + formatMetersAndCm(totalCm) : ''}
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">{renderTotal(line, index)}</div>
      </>
    )
  }

  function renderBatch(line: BatchLineForm, index: number) {
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor={'line-product-' + line.key} label="المنتج (بالعدد)">
            <select
              id={'line-product-' + line.key}
              value={line.productId}
              disabled={disabled}
              onChange={(event) => replace(index, { ...line, productId: event.target.value })}
              className={inputClasses}
            >
              <option value="">اختار منتج</option>
              {pieceProducts.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {productLabel(option)}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor={'line-qty-' + line.key} label="الكمية" hint="عدد صحيح">
            <input
              id={'line-qty-' + line.key}
              dir="ltr"
              inputMode="numeric"
              value={line.quantity}
              disabled={disabled}
              onChange={(event) => replace(index, { ...line, quantity: event.target.value })}
              className={inputClasses}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">{renderTotal(line, index)}</div>
      </>
    )
  }

  return (
    <div className="space-y-3">
      {lines.length === 0 ? <p className="text-xs text-muted">مفيش بنود لسه. ضيف بند لفّات أو بند قطع.</p> : null}

      {lines.map((line, index) => (
        <div key={line.key} className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-fg">
              بند {index + 1} · {line.kind === 'roll' ? 'لفّات (بالمتر)' : 'قطع (بالعدد)'}
            </p>
            <Button variant="ghost" size="sm" aria-label={'شيل بند ' + String(index + 1)} disabled={disabled} onClick={() => remove(index)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {line.kind === 'roll' ? renderRoll(line, index) : renderBatch(line, index)}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || full || meterProducts.length === 0}
          onClick={() => onChange([...lines, newRollLine(newKey(), newKey())])}
        >
          <Plus className="h-3.5 w-3.5" />
          بند لفّات (متر)
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || full || pieceProducts.length === 0}
          onClick={() => onChange([...lines, newBatchLine(newKey())])}
        >
          <Plus className="h-3.5 w-3.5" />
          بند قطع (عدد)
        </Button>
      </div>
    </div>
  )
}
