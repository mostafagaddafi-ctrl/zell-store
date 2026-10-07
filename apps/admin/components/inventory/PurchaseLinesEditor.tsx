'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useLineCards } from '../../lib/client/useLineCards'
import type { CatalogProduct } from '../../lib/inventory/catalog'
import { lineIssues, type LineDocKind } from '../../lib/inventory/lineIssues'
import type { LineEstimate } from '../../lib/inventory/openingForm'
import type { LineCosts } from '../../lib/inventory/pricing'
import { PURCHASE_LIMITS, newBatchLine, newRollLine, type LineForm } from '../../lib/inventory/purchaseForm'
import { Button } from '../ui/Button'
import { InventoryLineCard } from './InventoryLineCard'

/**
 * بنود المستند ككروت بتتفتح وتتقفل (مشترك بين الشراء ورصيد أول المدة):
 *   • لفّات (منتجات المتر بس) أو قطع (منتجات العدد بس)، واختيار المنتج بالبحث (ProductPicker).
 *   • البند الجديد بيتفتح لوحده.
 *   • revealNonce (بيزيد مع كل حفظ/معاينة فشلت): كل البنود اللي فيها مشكلة بتتفتح، وأول خانة غلط في
 *     أول بند بتاخد focus. المشاكل بتظهر بعد أول محاولة بس (showIssues) عشان البند الفاضي مايبانش غلط.
 *   • «قفل الكل» مابيقفلش بند فيه مشكلة ظاهرة.
 *   • costs (من المعاينة) بالترتيب: البند رقم i+1.
 * التحقق النهائي في build*Payload والسيرفر.
 */
export function PurchaseLinesEditor({
  lines,
  onChange,
  catalog,
  disabled,
  newKey,
  kind,
  totalLabel,
  showIssues,
  revealNonce,
  costs,
  estimates,
  renderLineExtra,
}: {
  lines: LineForm[]
  onChange: (lines: LineForm[]) => void
  catalog: CatalogProduct[]
  disabled: boolean
  newKey: () => string
  kind: LineDocKind
  totalLabel: string
  showIssues: boolean
  revealNonce: number
  costs: ReadonlyMap<number, LineCosts> | null
  estimates?: Readonly<Record<string, LineEstimate>>
  renderLineExtra?: (line: LineForm, index: number) => ReactNode
}) {
  const catalogMap = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog])
  const cards = useLineCards(lines.length <= 3 ? lines.map((line) => line.key) : [])
  const issues = useMemo(() => lineIssues(lines, catalogMap, kind, estimates), [lines, catalogMap, kind, estimates])
  const full = lines.length >= PURCHASE_LIMITS.lines
  const hasMeter = catalog.some((product) => product.saleUnit === 'meter')
  const hasPiece = catalog.some((product) => product.saleUnit === 'piece')

  useEffect(() => {
    if (revealNonce === 0 || issues.size === 0) return
    cards.openKeys(issues.keys())
    const first = lines.find((line) => issues.has(line.key))
    const field = first ? issues.get(first.key)?.field : undefined
    if (!first || !field) return
    const timer = setTimeout(() => {
      const target = document.querySelector<HTMLElement>('[data-line-key="' + first.key + '"] [data-field="' + field + '"]')
      if (target) {
        target.focus()
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }, 60)
    return () => clearTimeout(timer)
    // revealNonce بس هو المُحفّز — المشاكل بتتقرا من آخر render
  }, [revealNonce])

  function add(kindOfLine: 'roll' | 'batch') {
    const key = newKey()
    onChange([...lines, kindOfLine === 'roll' ? newRollLine(key, newKey()) : newBatchLine(key)])
    cards.openKeys([key])
  }

  return (
    <div className="space-y-3">
      {lines.length > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => cards.openKeys(lines.map((line) => line.key))}>
            فتح الكل
          </Button>
          <Button variant="ghost" size="sm" onClick={() => cards.closeAll(showIssues ? issues.keys() : [])}>
            قفل الكل
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted">مفيش بنود لسه. ضيف بند لفّات أو بند قطع.</p>
      )}

      {lines.map((line, index) => (
        <InventoryLineCard
          key={line.key}
          line={line}
          index={index}
          kind={kind}
          products={catalog}
          catalog={catalogMap}
          open={cards.isOpen(line.key)}
          onToggle={() => cards.toggle(line.key)}
          onChange={(next) => onChange(lines.map((current, i) => (i === index ? next : current)))}
          onRemove={() => onChange(lines.filter((_line, i) => i !== index))}
          disabled={disabled}
          issue={showIssues ? (issues.get(line.key) ?? null) : null}
          costs={costs ? (costs.get(index + 1) ?? null) : null}
          totalLabel={totalLabel}
          extra={renderLineExtra ? renderLineExtra(line, index) : undefined}
          newKey={newKey}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={disabled || full || !hasMeter} onClick={() => add('roll')}>
          <Plus className="h-3.5 w-3.5" />
          بند لفّات (متر)
        </Button>
        <Button variant="secondary" size="sm" disabled={disabled || full || !hasPiece} onClick={() => add('batch')}>
          <Plus className="h-3.5 w-3.5" />
          بند قطع (عدد)
        </Button>
      </div>
    </div>
  )
}
