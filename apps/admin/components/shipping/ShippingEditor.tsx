'use client'

import { useState } from 'react'
import type { SaveState, ShippingSettings } from '../../lib/adminData'
import { formatPiastres, piastresToPounds } from '../../lib/format'
import { Card, Field, inputClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'
import { Table, TD, TH, THead, TR } from '../ui/Table'

export function ShippingEditor({ shipping }: { shipping: ShippingSettings }) {
  const [state, setState] = useState<SaveState>('idle')
  const [draft, setDraft] = useState(shipping)

  const governorates = Object.keys(draft.rates).sort((a, b) => a.localeCompare(b, 'ar'))

  const touch = (next: ShippingSettings) => {
    setDraft(next)
    setState('dirty')
  }

  return (
    <div className="space-y-4">
      <Card title="القواعد العامة">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="default" label="سعر الشحن الافتراضي (ج.م)" hint="بيتطبق على أي محافظة مالهاش سعر">
            <input
              id="default"
              type="number"
              min={0}
              value={piastresToPounds(draft.defaultPiastres)}
              onChange={(e) => touch({ ...draft, defaultPiastres: Math.round(Number(e.target.value) * 100) })}
              className={inputClasses}
            />
          </Field>
          <Field htmlFor="free" label="حد الشحن المجاني (ج.م)" hint="صفر = متعطّل">
            <input
              id="free"
              type="number"
              min={0}
              value={piastresToPounds(draft.freeThresholdPiastres)}
              onChange={(e) => touch({ ...draft, freeThresholdPiastres: Math.round(Number(e.target.value) * 100) })}
              className={inputClasses}
            />
          </Field>
        </div>
      </Card>

      <Table>
        <THead>
          <TR>
            <TH>المحافظة</TH>
            <TH className="w-40">السعر (ج.م)</TH>
            <TH className="w-28">الحالي</TH>
            <TH className="w-24">مفعّلة</TH>
          </TR>
        </THead>
        <tbody>
          {governorates.map((name) => {
            const value = draft.rates[name] ?? 0
            const enabled = !draft.disabled.includes(name)
            return (
              <TR key={name}>
                <TD className="font-medium">{name}</TD>
                <TD>
                  <input
                    type="number"
                    min={0}
                    value={piastresToPounds(value)}
                    onChange={(e) =>
                      touch({ ...draft, rates: { ...draft.rates, [name]: Math.round(Number(e.target.value) * 100) } })
                    }
                    className={inputClasses + ' h-8'}
                    aria-label={'سعر شحن ' + name}
                  />
                </TD>
                <TD className="text-xs text-muted">{formatPiastres(value)}</TD>
                <TD>
                  <Switch checked={enabled} onChange={() => undefined} disabled label={'تفعيل ' + name} />
                </TD>
              </TR>
            )
          })}
        </tbody>
      </Table>

      <SaveBar state={state} />
    </div>
  )
}
