'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { saveOrderShipmentAction } from '../../lib/orderActions'
import { formatCairoDateTime } from '../../lib/orders/cycle'
import {
  adoptShipmentLatest,
  boundSend,
  editShipmentDraft,
  refreshBounds,
  shipmentDraftAfterSave,
  shipmentDraftOf,
  shipmentDraftStale,
  shipmentIntentOf,
  syncShipmentDraft,
  type ShipmentIntent,
} from '../../lib/orders/trackDrafts'
import {
  CARRIER_MAX,
  SHIPMENT_TEXT,
  TRACKING_NUMBER_MAX,
  TRACKING_URL_MAX,
  expectedMax,
  shipmentPayload,
  type ShipmentBounds,
  type ShipmentField,
  type ShipmentForm,
  type ShipmentView,
} from '../../lib/orders/trackUpdates'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, Field, inputClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * TRACK-ORDER v2 W2-B — كارت «بيانات الشحنة» في صفحة الطلب (العقد TRACK-ORDER-v2 §٥ · §١٧-٢). بيان لوحده، مش تغيير حالة.
 * المسودة ليها نسخة بداية منفصلة عن أحدث نسخة معروضة (lib/orders/trackDrafts.ts): وصول props أحدث مابيربطش المسودة المتعدّلة
 * بالنسخة الجديدة، والكارت بيعرض إن البيانات اتغيّرت ويقفل الحفظ لحد ما المستخدم يختار «اعتماد أحدث نسخة مع الاحتفاظ بما كتبته»
 * أو «تجاهل ما كتبته». كل حفظ بنية ثابتة (النسخة + المدخلات)، وإعادة المحاولة بتبعتها بالحرف. التعارض (45404): إعادة قراية
 * تلقائية (router.refresh) مع الاحتفاظ بالفورم، ومفيش إعادة إرسال تلقائية. القرار النهائي في zell_shipment_save.
 */
export function OrderShipmentCard({
  orderNumber,
  view,
  bounds,
}: {
  orderNumber: string
  view: ShipmentView | null
  bounds: ShipmentBounds | null
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry, markDirty, reset } = useSaveAction()
  const [draft, setDraft] = useState(() => shipmentDraftOf(view))
  const [issue, setIssue] = useState<{ field: ShipmentField; message: string } | null>(null)
  const [changed, setChanged] = useState(true)
  const busy = state === 'saving'

  // props جديدة: المسودة المتعدّلة بتفضل على نسختها، واللي ماتعدّلتش بتتبع السيرفر.
  useEffect(() => {
    setDraft((current) => syncShipmentDraft(current, view))
  }, [view])

  // 45404: نقرا أحدث نسخة من غير ما نمسح الفورم.
  useEffect(() => {
    if (state === 'conflict') router.refresh()
  }, [state, router])

  if (view === null) {
    return (
      <Card title={SHIPMENT_TEXT.title}>
        <p className="text-xs text-muted">{SHIPMENT_TEXT.unavailable}</p>
      </Card>
    )
  }

  const latest = view
  const current = latest.shipment
  const stale = shipmentDraftStale(draft, latest)
  const disabled = !mutationsOn || busy
  const form = draft.form

  function update(key: keyof ShipmentForm, value: string) {
    setDraft((prev) => editShipmentDraft(prev, key, value))
    setIssue(null)
    if (state !== 'idle' && state !== 'saving') markDirty()
  }

  function adopt() {
    setDraft((prev) => adoptShipmentLatest(prev, latest))
    setIssue(null)
    reset()
  }

  function discard() {
    setDraft(shipmentDraftOf(latest))
    setIssue(null)
    reset()
  }

  function save() {
    if (stale) return
    const checked = shipmentPayload(draft.form, bounds === null ? null : refreshBounds(bounds, Date.now()))
    if (!checked.ok) {
      setIssue({ field: checked.field, message: checked.message })
      return
    }
    setIssue(null)
    const intent = shipmentIntentOf(draft)
    void run(
      boundSend(intent, (i: ShipmentIntent) => saveOrderShipmentAction(orderNumber, i.expectedUpdatedAt, i.form)),
      {
        onSuccess: (data) => {
          setChanged(data.changed)
          setDraft(shipmentDraftAfterSave(intent, data.version))
          router.refresh()
        },
      },
    )
  }

  const errorOf = (field: ShipmentField) => (issue !== null && issue.field === field ? issue.message : undefined)

  return (
    <Card title={SHIPMENT_TEXT.title}>
      <div className="space-y-2.5">
        <p className="text-xs leading-relaxed text-muted">{SHIPMENT_TEXT.intro}</p>

        {current === null ? (
          <p className="text-sm text-fg">{SHIPMENT_TEXT.none}</p>
        ) : (
          <div className="space-y-1 rounded border border-border bg-bg p-2 text-xs text-fg">
            <p className="text-sm font-semibold">{current.carrier}</p>
            {current.trackingNumber !== null ? (
              <p dir="ltr" className="text-end font-mono">
                {current.trackingNumber}
              </p>
            ) : null}
            {current.trackingUrl !== null ? (
              <a
                href={current.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {SHIPMENT_TEXT.openLink}
              </a>
            ) : null}
            {current.shippedOn !== null ? <p>{SHIPMENT_TEXT.shippedOn + ': ' + current.shippedOn}</p> : null}
            {current.expectedOn !== null ? <p>{SHIPMENT_TEXT.expectedOn + ': ' + current.expectedOn}</p> : null}
            <p className="text-muted">{SHIPMENT_TEXT.lastUpdated + formatCairoDateTime(current.updatedAt)}</p>
          </div>
        )}

        {latest.editable ? (
          <>
            {stale ? (
              <div role="alert" className="space-y-2 rounded border-s-2 border-gold bg-gold/10 p-2 text-xs text-fg">
                <p>{SHIPMENT_TEXT.stale}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={adopt}>
                    {SHIPMENT_TEXT.adopt}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={discard}>
                    {SHIPMENT_TEXT.discard}
                  </Button>
                </div>
              </div>
            ) : null}
            <Field htmlFor="shipment-carrier" label={SHIPMENT_TEXT.carrier} error={errorOf('carrier')}>
              <input
                id="shipment-carrier"
                value={form.carrier}
                maxLength={CARRIER_MAX * 2}
                onChange={(event) => update('carrier', event.target.value)}
                className={inputClasses}
                disabled={disabled}
              />
            </Field>
            <Field htmlFor="shipment-number" label={SHIPMENT_TEXT.trackingNumber} error={errorOf('tracking_number')}>
              <input
                id="shipment-number"
                dir="ltr"
                value={form.trackingNumber}
                maxLength={TRACKING_NUMBER_MAX * 2}
                onChange={(event) => update('trackingNumber', event.target.value)}
                className={inputClasses}
                disabled={disabled}
              />
            </Field>
            <Field
              htmlFor="shipment-url"
              label={SHIPMENT_TEXT.trackingUrl}
              hint={SHIPMENT_TEXT.trackingUrlHint}
              error={errorOf('tracking_url')}
            >
              <input
                id="shipment-url"
                dir="ltr"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={form.trackingUrl}
                maxLength={TRACKING_URL_MAX}
                onChange={(event) => update('trackingUrl', event.target.value)}
                className={inputClasses}
                disabled={disabled}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field htmlFor="shipment-shipped" label={SHIPMENT_TEXT.shippedOn} error={errorOf('shipped_on')}>
                <input
                  id="shipment-shipped"
                  type="date"
                  value={form.shippedOn}
                  min={bounds?.orderDay}
                  onChange={(event) => update('shippedOn', event.target.value)}
                  className={inputClasses}
                  disabled={disabled}
                />
              </Field>
              <Field htmlFor="shipment-expected" label={SHIPMENT_TEXT.expectedOn} error={errorOf('expected_on')}>
                <input
                  id="shipment-expected"
                  type="date"
                  value={form.expectedOn}
                  min={form.shippedOn !== '' ? form.shippedOn : bounds?.orderDay}
                  max={bounds !== null ? expectedMax(bounds) : undefined}
                  onChange={(event) => update('expectedOn', event.target.value)}
                  className={inputClasses}
                  disabled={disabled}
                />
              </Field>
            </div>
            <p className="text-xs text-muted">{SHIPMENT_TEXT.expectedHint}</p>
            <p className="text-xs text-muted">{SHIPMENT_TEXT.noDelete}</p>
            {state === 'saved' ? (
              <p role="status" className="text-xs text-ok">
                {changed ? SHIPMENT_TEXT.saved : SHIPMENT_TEXT.unchanged}
              </p>
            ) : null}
            <Button size="sm" disabled={disabled || stale} onClick={save}>
              {busy ? SHIPMENT_TEXT.saving : SHIPMENT_TEXT.save}
            </Button>
            <FailureBanner failure={failure} onRetry={retry} />
          </>
        ) : (
          <p className="text-xs text-muted">{SHIPMENT_TEXT.locked}</p>
        )}
      </div>
    </Card>
  )
}
