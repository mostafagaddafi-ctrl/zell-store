'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { orderGovernorates } from '@zell/core'
import { saveShippingAction } from '../../lib/actions'
import type { ShippingSettings } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { formatPiastres, piastresToPounds } from '../../lib/format'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'

/**
 * الشحن: القواعد العامة + كل محافظة (سعر · تفعيل · ترتيب).
 *
 * الترتيب هنا = ترتيب القايمة في صفحة الطلب وصفحة فني التركيب.
 * لحد ما يتحفظ ترتيب: القاهرة والجيزة الأول والباقي أبجدي.
 *
 * ⚠️ قايمة كروت مش جدول: الجدول (42rem) كان بيعمل سكرول جانبي على الموبايل.
 */
export function ShippingEditor({ shipping, order }: { shipping: ShippingSettings; order: string[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState(shipping)
  const [sequence, setSequence] = useState<string[]>(() => orderGovernorates(Object.keys(shipping.rates), order))

  const touch = (next: ShippingSettings) => {
    setDraft(next)
    markDirty()
  }

  /** «حاول تاني» لازم تبعت أحدث draft مش نسخة من وقت الضغط الأول. */
  const draftRef = useRef(draft)
  draftRef.current = draft
  const sequenceRef = useRef(sequence)
  sequenceRef.current = sequence

  const [syncedAt, setSyncedAt] = useState(shipping.updatedAt)
  useEffect(() => {
    if (shipping.updatedAt === syncedAt) return
    setSyncedAt(shipping.updatedAt)
    setDraft(shipping)
    setSequence(orderGovernorates(Object.keys(shipping.rates), order))
  }, [shipping, syncedAt, order])

  function move(index: number, delta: -1 | 1) {
    setSequence((current) => {
      const target = index + delta
      const a = current[index]
      const b = current[target]
      if (a === undefined || b === undefined) return current
      const copy = [...current]
      copy[index] = b
      copy[target] = a
      return copy
    })
    markDirty()
  }

  function save() {
    void run(() => saveShippingAction(draftRef.current, draftRef.current.updatedAt, sequenceRef.current), {
      onSuccess: () => router.refresh(),
    })
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

      <Card title="المحافظات">
        <p className="mb-3 text-xs text-muted">الترتيب هنا هو ترتيب القايمة في صفحة الطلب — حط الأهم فوق.</p>
        <ul className="space-y-2">
          {sequence.map((name, index) => {
            const value = draft.rates[name] ?? 0
            const enabled = !draft.disabled.includes(name)
            return (
              <li key={name} className="rounded border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 shrink-0 text-center text-xs font-bold tabular-nums text-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{name}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" aria-label={'حرّك ' + name + ' لفوق'} disabled={!mutationsOn || index === 0} onClick={() => move(index, -1)}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={'حرّك ' + name + ' لتحت'}
                      disabled={!mutationsOn || index === sequence.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 ps-8">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    السعر (ج.م)
                    <input
                      type="number"
                      min={0}
                      value={piastresToPounds(value)}
                      onChange={(e) =>
                        touch({ ...draft, rates: { ...draft.rates, [name]: Math.round(Number(e.target.value) * 100) } })
                      }
                      className={inputClasses + ' w-28'}
                      aria-label={'سعر شحن ' + name}
                    />
                  </label>
                  <span className="text-xs text-muted">{formatPiastres(value)}</span>
                  <span className="ms-auto flex items-center gap-2 text-xs text-fg">
                    <Switch
                      checked={enabled}
                      onChange={(next) =>
                        touch({
                          ...draft,
                          disabled: next ? draft.disabled.filter((item) => item !== name) : [...draft.disabled, name],
                        })
                      }
                      disabled={!mutationsOn}
                      label={'تفعيل ' + name}
                    />
                    مفعّلة
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      <SaveBar state={state} onSave={save} warning={warning} />
    </div>
  )
}
