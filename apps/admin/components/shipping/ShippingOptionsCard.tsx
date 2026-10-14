'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { saveShippingOptionsAction } from '../../lib/orderActions'
import {
  SHIPPING_DAYS_MAX,
  SHIPPING_OPTIONS_TEXT,
  formOf,
  inputOf,
  type GovernorateRowForm,
  type ShippingOptionsForm,
  type ShippingOptionsSettings,
} from '../../lib/orders/shippingOptions'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, inputClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * EXPRESS-SHIPPING W2 — كارت «مدة الشحن والشحن السريع» في صفحة الشحن. القراية لأي أدمن، والحفظ للمالك بس (والقرار النهائي
 * في الداتابيز). حفظ واحد بالنسخة وبزرار لوحده (مستقل عن أسعار الشحن العادي)، وبعد النجاح الصفحة بتتحدّث فالقيم بتتقرا تاني
 * من الداتابيز. مفيش أي حفظ تلقائي.
 */
export function ShippingOptionsCard({
  settings,
  served,
  canSave,
}: {
  settings: ShippingOptionsSettings | null
  /** المحافظات المتاحة في الشحن العادي بترتيبه. */
  served: string[]
  canSave: boolean
}) {
  if (settings === null) {
    return (
      <Card title={SHIPPING_OPTIONS_TEXT.title}>
        <p className="text-xs text-muted">{SHIPPING_OPTIONS_TEXT.unavailable}</p>
      </Card>
    )
  }
  return <ShippingOptionsEditor settings={settings} served={served} canSave={canSave} />
}

function DaysInputs({
  idPrefix,
  min,
  max,
  disabled,
  onChange,
}: {
  idPrefix: string
  min: string
  max: string
  disabled: boolean
  onChange: (patch: { min?: string; max?: string }) => void
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <label htmlFor={idPrefix + '-min'}>{SHIPPING_OPTIONS_TEXT.from}</label>
      <input
        id={idPrefix + '-min'}
        inputMode="numeric"
        dir="ltr"
        value={min}
        maxLength={2}
        onChange={(event) => onChange({ min: event.target.value })}
        className={inputClasses + ' w-16'}
        disabled={disabled}
      />
      <label htmlFor={idPrefix + '-max'}>{SHIPPING_OPTIONS_TEXT.to}</label>
      <input
        id={idPrefix + '-max'}
        inputMode="numeric"
        dir="ltr"
        value={max}
        maxLength={2}
        onChange={(event) => onChange({ max: event.target.value })}
        className={inputClasses + ' w-16'}
        disabled={disabled}
      />
      <span>{'(0–' + String(SHIPPING_DAYS_MAX) + ')'}</span>
    </div>
  )
}

function ShippingOptionsEditor({ settings, served, canSave }: { settings: ShippingOptionsSettings; served: string[]; canSave: boolean }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const [form, setForm] = useState<ShippingOptionsForm>(() => formOf(settings, served))
  const [issue, setIssue] = useState<string | null>(null)
  const busy = state === 'saving'
  const disabled = !canSave || !mutationsOn || busy

  function setRow(index: number, patch: Partial<GovernorateRowForm>) {
    setForm((current) => ({ ...current, rows: current.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) }))
  }

  function save() {
    const built = inputOf(form, settings)
    if (!built.ok) {
      setIssue(built.message)
      return
    }
    setIssue(null)
    const input = built.input
    void run(() => saveShippingOptionsAction(input), { onSuccess: () => router.refresh() })
  }

  return (
    <Card title={SHIPPING_OPTIONS_TEXT.title}>
      <div className="space-y-3">
        <p className="text-xs text-muted">{SHIPPING_OPTIONS_TEXT.intro}</p>
        <p className="text-xs text-muted">{SHIPPING_OPTIONS_TEXT.separateSave}</p>

        <label className="flex items-center gap-2 text-sm font-semibold text-fg">
          <input
            type="checkbox"
            checked={form.expressEnabled}
            onChange={(event) => setForm((current) => ({ ...current, expressEnabled: event.target.checked }))}
            disabled={disabled}
          />
          {SHIPPING_OPTIONS_TEXT.globalToggle}
        </label>
        <p className="text-xs text-muted">{SHIPPING_OPTIONS_TEXT.globalHint}</p>
        <p className="text-xs text-muted">{SHIPPING_OPTIONS_TEXT.freeNote}</p>

        {form.rows.length === 0 ? <p className="text-xs text-muted">{SHIPPING_OPTIONS_TEXT.empty}</p> : null}
        <ul className="divide-y divide-border rounded-md border border-border">
          {form.rows.map((row, index) => (
            <li key={row.name} className="space-y-2 p-3">
              <p className="text-sm font-semibold text-fg">{row.name}</p>
              {!row.served ? <p className="text-xs font-medium text-danger">{SHIPPING_OPTIONS_TEXT.notServed}</p> : null}
              <div className="space-y-1">
                <p className="text-xs font-semibold text-fg">{SHIPPING_OPTIONS_TEXT.standardDays}</p>
                <DaysInputs
                  idPrefix={'std-' + String(index)}
                  min={row.standardMin}
                  max={row.standardMax}
                  disabled={disabled}
                  onChange={(patch) =>
                    setRow(index, {
                      ...(patch.min !== undefined ? { standardMin: patch.min } : {}),
                      ...(patch.max !== undefined ? { standardMax: patch.max } : {}),
                    })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-fg">
                <input
                  type="checkbox"
                  checked={row.expressEnabled}
                  onChange={(event) => setRow(index, { expressEnabled: event.target.checked })}
                  disabled={disabled}
                />
                {SHIPPING_OPTIONS_TEXT.expressToggle}
              </label>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <label htmlFor={'price-' + String(index)}>{SHIPPING_OPTIONS_TEXT.expressPrice}</label>
                <input
                  id={'price-' + String(index)}
                  inputMode="decimal"
                  dir="ltr"
                  value={row.expressPrice}
                  maxLength={10}
                  onChange={(event) => setRow(index, { expressPrice: event.target.value })}
                  className={inputClasses + ' w-28'}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-fg">{SHIPPING_OPTIONS_TEXT.expressDays}</p>
                <DaysInputs
                  idPrefix={'exp-' + String(index)}
                  min={row.expressMin}
                  max={row.expressMax}
                  disabled={disabled}
                  onChange={(patch) =>
                    setRow(index, {
                      ...(patch.min !== undefined ? { expressMin: patch.min } : {}),
                      ...(patch.max !== undefined ? { expressMax: patch.max } : {}),
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>

        {issue !== null ? <p className="text-xs font-medium text-danger">{issue}</p> : null}
        {state === 'saved' ? (
          <p role="status" className="text-xs text-ok">
            {SHIPPING_OPTIONS_TEXT.saved}
          </p>
        ) : null}
        {canSave ? (
          <Button size="sm" disabled={disabled} onClick={save}>
            {busy ? SHIPPING_OPTIONS_TEXT.saving : SHIPPING_OPTIONS_TEXT.save}
          </Button>
        ) : (
          <p className="text-xs text-muted">{SHIPPING_OPTIONS_TEXT.ownerOnly}</p>
        )}
        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
