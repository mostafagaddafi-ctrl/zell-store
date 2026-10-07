'use client'

import { Plus, Trash2 } from 'lucide-react'
import {
  CHARGE_KINDS,
  CHARGE_KIND_LABELS,
  PURCHASE_LIMITS,
  newCharge,
  type ChargeForm,
  type ChargeKind,
} from '../../lib/inventory/purchaseForm'
import { Button } from '../ui/Button'
import { Field, inputClasses } from '../ui/Field'

/**
 * المصاريف الإضافية (نقل · تحميل وتنزيل · جمارك · أخرى). كل نوع بيتوزّع على الدفعات لوحده في
 * الداتابيز (largest remainder). «أخرى» محتاج ملاحظة. مفيش مدفوعات ولا ضرايب في v1.
 */
export function PurchaseChargesEditor({
  charges,
  onChange,
  disabled,
  newKey,
}: {
  charges: ChargeForm[]
  onChange: (charges: ChargeForm[]) => void
  disabled: boolean
  newKey: () => string
}) {
  function replace(index: number, charge: ChargeForm) {
    onChange(charges.map((current, i) => (i === index ? charge : current)))
  }

  return (
    <div className="space-y-3">
      {charges.length === 0 ? <p className="text-xs text-muted">مفيش مصاريف إضافية.</p> : null}
      {charges.map((charge, index) => (
        <div key={charge.key} className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-fg">مصروف {index + 1}</p>
            <Button
              variant="ghost"
              size="sm"
              aria-label={'شيل مصروف ' + String(index + 1)}
              disabled={disabled}
              onClick={() => onChange(charges.filter((_c, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field htmlFor={'charge-kind-' + charge.key} label="النوع">
              <select
                id={'charge-kind-' + charge.key}
                value={charge.kind}
                disabled={disabled}
                onChange={(event) => {
                  const kind = CHARGE_KINDS.find((k) => k === event.target.value)
                  if (kind) replace(index, { ...charge, kind: kind as ChargeKind })
                }}
                className={inputClasses}
              >
                {CHARGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CHARGE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor={'charge-amount-' + charge.key} label="المبلغ (جنيه)" hint="أكبر من صفر · بالإنجليزي">
              <input
                id={'charge-amount-' + charge.key}
                dir="ltr"
                inputMode="decimal"
                value={charge.amount}
                disabled={disabled}
                onChange={(event) => replace(index, { ...charge, amount: event.target.value })}
                className={inputClasses}
              />
            </Field>
            <Field htmlFor={'charge-ref-' + charge.key} label="المرجع" hint={'اختياري · لحد ' + String(PURCHASE_LIMITS.chargeReference) + ' حرف'}>
              <input
                id={'charge-ref-' + charge.key}
                value={charge.reference}
                maxLength={PURCHASE_LIMITS.chargeReference + 20}
                disabled={disabled}
                onChange={(event) => replace(index, { ...charge, reference: event.target.value })}
                className={inputClasses}
              />
            </Field>
            <Field
              htmlFor={'charge-note-' + charge.key}
              label="ملاحظة"
              hint={charge.kind === 'other' ? 'إجبارية لنوع «أخرى» · من 3 لـ 200 حرف' : 'اختياري · من 3 لـ 200 حرف'}
            >
              <input
                id={'charge-note-' + charge.key}
                value={charge.note}
                maxLength={PURCHASE_LIMITS.chargeNoteMax + 20}
                disabled={disabled}
                onChange={(event) => replace(index, { ...charge, note: event.target.value })}
                className={inputClasses}
              />
            </Field>
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || charges.length >= PURCHASE_LIMITS.charges}
        onClick={() => onChange([...charges, newCharge(newKey())])}
      >
        <Plus className="h-3.5 w-3.5" />
        مصروف
      </Button>
    </div>
  )
}
