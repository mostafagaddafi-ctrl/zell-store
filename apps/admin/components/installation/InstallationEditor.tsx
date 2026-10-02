'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveInstallationAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'

type Settings = { enabled: boolean; note: string; governorates: string[] }

/**
 * فني التركيب — بالتواصل. الزبون بيدوس «محتاج فني تركيب؟» في صفحة الطلب،
 * والطلب بيوصل عليه علامة 🔧، وانت بتتفق معاه على المعاد والسعر.
 */
export function InstallationEditor({ initial, governorates }: { initial: Settings; governorates: string[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState<Settings>(initial)

  const touch = (patch: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...patch }))
    markDirty()
  }

  const toggleGovernorate = (name: string) => {
    touch({
      governorates: draft.governorates.includes(name)
        ? draft.governorates.filter((item) => item !== name)
        : [...draft.governorates, name],
    })
  }

  function save() {
    void run(() => saveInstallationAction(draft), { onSuccess: () => router.refresh() })
  }

  return (
    <div className="space-y-4">
      <Card title="الخدمة">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">إظهار «محتاج فني تركيب؟» في صفحة الطلب</p>
              <p className="text-xs text-muted">بيظهر للزبون في المحافظات اللي هتختارها تحت بس.</p>
            </div>
            <Switch
              checked={draft.enabled}
              onChange={(next) => touch({ enabled: next })}
              label="إظهار خيار فني التركيب"
              disabled={!mutationsOn}
            />
          </div>

          <Field
            htmlFor="installation-note"
            label="سطر التوضيح (اختياري)"
            hint="بيظهر تحت الزرار. مثلًا: المتاح، وإن السعر بيتحدد بالتواصل حسب المنطقة والكمية."
          >
            <textarea
              id="installation-note"
              value={draft.note}
              onChange={(event) => touch({ note: event.target.value })}
              className={textareaClasses}
              rows={2}
              maxLength={300}
              placeholder="اكتب سطر التوضيح"
            />
          </Field>
        </div>
      </Card>

      <Card
        title={'المحافظات اللي فيها تركيب (' + String(draft.governorates.length) + ')'}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={!mutationsOn} onClick={() => touch({ governorates: [...governorates] })}>
              الكل
            </Button>
            <Button variant="ghost" size="sm" disabled={!mutationsOn} onClick={() => touch({ governorates: [] })}>
              ولا واحدة
            </Button>
          </div>
        }
      >
        {governorates.length === 0 ? (
          <p className="text-xs text-muted">مفيش محافظات في جدول الشحن.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {governorates.map((name) => (
              <label key={name} className="flex items-center gap-2 rounded border border-border px-2.5 py-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={draft.governorates.includes(name)}
                  onChange={() => toggleGovernorate(name)}
                  disabled={!mutationsOn}
                  className="h-4 w-4 shrink-0 accent-brand"
                />
                <span className="truncate">{name}</span>
              </label>
            ))}
          </div>
        )}
        {draft.enabled && draft.governorates.length === 0 ? (
          <p className="mt-3 text-xs font-semibold text-gold">الخيار مش هيظهر لحد ما تختار محافظة واحدة على الأقل.</p>
        ) : null}
      </Card>

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      <SaveBar state={state} onSave={save} warning={warning} />
    </div>
  )
}
