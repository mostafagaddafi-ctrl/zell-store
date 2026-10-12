'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { saveDeliverySettingsAction } from '../../lib/orderActions'
import {
  DELIVERY_NOTE_MAX,
  DELIVERY_SETTINGS_TEXT,
  deliveryPreview,
  deliverySettingsIssue,
  formOf,
  inputOf,
  noteLength,
  type DeliverySettings,
  type DeliverySettingsForm,
} from '../../lib/orders/deliverySettings'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, Field, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * 0021-D2 — كارت «موعد التسليم في صفحة الطلب». القراية لأي أدمن، والحفظ للمالك بس (والقرار النهائي في الداتابيز).
 * حفظ واحد بالنسخة، وبعد النجاح الصفحة بتتحدّث فالقيم بتتقرا تاني من الداتابيز. مفيش أي حفظ تلقائي.
 */
export function DeliverySettingsCard({ settings, canSave }: { settings: DeliverySettings | null; canSave: boolean }) {
  if (settings === null) {
    return (
      <Card title={DELIVERY_SETTINGS_TEXT.title}>
        <p className="text-xs text-muted">{DELIVERY_SETTINGS_TEXT.unavailable}</p>
      </Card>
    )
  }
  return <DeliverySettingsEditor settings={settings} canSave={canSave} />
}

function DeliverySettingsEditor({ settings, canSave }: { settings: DeliverySettings; canSave: boolean }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const [form, setForm] = useState<DeliverySettingsForm>(() => formOf(settings))
  const [issue, setIssue] = useState<string | null>(null)
  const busy = state === 'saving'
  const disabled = !canSave || !mutationsOn || busy
  const set = (patch: Partial<DeliverySettingsForm>) => setForm((current) => ({ ...current, ...patch }))
  const preview = deliveryPreview(form)

  function save() {
    const problem = deliverySettingsIssue(form)
    if (problem !== null) {
      setIssue(problem)
      return
    }
    setIssue(null)
    const input = inputOf(form, settings)
    void run(() => saveDeliverySettingsAction(input), { onSuccess: () => router.refresh() })
  }

  return (
    <Card title={DELIVERY_SETTINGS_TEXT.title}>
      <div className="space-y-3">
        <p className="text-xs text-muted">{DELIVERY_SETTINGS_TEXT.intro}</p>

        <label className="flex items-center gap-2 text-sm font-semibold text-fg">
          <input
            type="checkbox"
            checked={form.customerChoiceEnabled}
            onChange={(event) => set({ customerChoiceEnabled: event.target.checked })}
            disabled={disabled}
          />
          {DELIVERY_SETTINGS_TEXT.choice}
        </label>
        <p className="text-xs text-muted">{DELIVERY_SETTINGS_TEXT.choiceHint}</p>

        <label className="flex items-center gap-2 text-sm font-semibold text-fg">
          <input type="checkbox" checked={form.noteEnabled} onChange={(event) => set({ noteEnabled: event.target.checked })} disabled={disabled} />
          {DELIVERY_SETTINGS_TEXT.noteToggle}
        </label>
        <Field htmlFor="delivery-note" label={DELIVERY_SETTINGS_TEXT.noteLabel} hint={DELIVERY_SETTINGS_TEXT.noteHint}>
          <textarea
            id="delivery-note"
            value={form.noteText}
            maxLength={DELIVERY_NOTE_MAX + 20}
            onChange={(event) => set({ noteText: event.target.value })}
            className={textareaClasses}
            disabled={disabled}
          />
        </Field>
        <p className="text-xs text-muted">{String(noteLength(form.noteText.trim())) + ' / ' + String(DELIVERY_NOTE_MAX)}</p>

        <div className="rounded-md border border-border bg-bg p-3 text-xs text-fg">
          <p className="font-semibold">{DELIVERY_SETTINGS_TEXT.preview}</p>
          <p className="mt-1">{preview.choice}</p>
          <p className="mt-1">{preview.note ?? DELIVERY_SETTINGS_TEXT.previewNoNote}</p>
        </div>

        {issue !== null ? <p className="text-xs font-medium text-danger">{issue}</p> : null}
        {state === 'saved' ? (
          <p role="status" className="text-xs text-ok">
            {DELIVERY_SETTINGS_TEXT.saved}
          </p>
        ) : null}
        {canSave ? (
          <Button size="sm" disabled={disabled} onClick={save}>
            {busy ? DELIVERY_SETTINGS_TEXT.saving : DELIVERY_SETTINGS_TEXT.save}
          </Button>
        ) : (
          <p className="text-xs text-muted">{DELIVERY_SETTINGS_TEXT.ownerOnly}</p>
        )}
        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
