'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { INSTALLATION_LIMITS, type InstallationAreas } from '@zell/core'
import { saveInstallationAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { formatPiastres, piastresToPounds } from '../../lib/format'
import type { InstallationInput } from '../../lib/mutations/installation'
import type { InstallationRecord, ShippingAreaGroup } from '../../lib/data/installation'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'

/** المسودة بالجنيه كنص زي ما الأدمن بيكتب. المنطقة المفعّلة = موجودة في areas. */
type Draft = { enabled: boolean; note: string; fee: string; areas: Record<string, Record<string, string>> }

const MAX_POUNDS = INSTALLATION_LIMITS.maxPiastres / 100

/** «100» أو «99.5» → قرش. فاضي · سالب · أكتر من رقمين عشريين · فوق الحد = null. */
function toPiastres(text: string, min: 0 | 1): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  const piastres = Math.round(value * 100)
  if (Math.abs(piastres - value * 100) > 1e-6) return null
  if (piastres < min || piastres > INSTALLATION_LIMITS.maxPiastres) return null
  return piastres
}

/** المناطق اللي اتشالت من الشحن مابتدخلش المسودة — بتتشال من الإعداد مع أول حفظ. */
function toDraft(record: InstallationRecord, groups: ShippingAreaGroup[]): Draft {
  const areas: Draft['areas'] = {}
  for (const group of groups) {
    const saved = record.config.areas[group.governorate] ?? {}
    const out: Record<string, string> = {}
    for (const area of group.areas) {
      const travel = saved[area]
      if (travel !== undefined) out[area] = piastresToPounds(travel)
    }
    if (Object.keys(out).length > 0) areas[group.governorate] = out
  }
  const fee = record.config.feePerMeterPiastres
  return { enabled: record.config.enabled, note: record.config.note, fee: fee === null ? '' : piastresToPounds(fee), areas }
}

function orphansOf(areas: InstallationAreas, groups: ShippingAreaGroup[]): string[] {
  const shipping = new Map(groups.map((group) => [group.governorate, group.areas]))
  const out: string[] = []
  for (const [governorate, list] of Object.entries(areas)) {
    const known = shipping.get(governorate) ?? []
    for (const area of Object.keys(list)) if (!known.includes(area)) out.push(area + ' (' + governorate + ')')
  }
  return out
}

type Checked = { ok: true; input: InstallationInput } | { ok: false; error: string }

function validate(draft: Draft): Checked {
  const feeText = draft.fee.trim()
  const fee = feeText === '' ? null : toPiastres(feeText, 1)
  if (feeText !== '' && fee === null) {
    return { ok: false, error: 'سعر تركيب المتر لازم يكون رقم من 0.01 لـ ' + String(MAX_POUNDS) + ' جنيه' }
  }
  const areas: InstallationAreas = {}
  let count = 0
  for (const [governorate, list] of Object.entries(draft.areas)) {
    const out: Record<string, number> = {}
    for (const [area, text] of Object.entries(list)) {
      const travel = toPiastres(text, 0)
      if (travel === null) {
        return { ok: false, error: 'اكتب انتقال الفني لـ«' + area + '» (' + governorate + ') — صفر = انتقال مجاني' }
      }
      out[area] = travel
      count += 1
    }
    if (Object.keys(out).length > 0) areas[governorate] = out
  }
  if (fee === null && (draft.enabled || count > 0)) return { ok: false, error: 'اكتب سعر تركيب المتر' }
  return { ok: true, input: { enabled: draft.enabled, note: draft.note, feePerMeterPiastres: fee, areas } }
}

/**
 * فني التركيب: التشغيل · سعر تركيب المتر · المناطق المتاحة وانتقال كل منطقة.
 *
 * ⚠️ أسماء المناطق جاية من صفحة الشحن بس — مفيش خانة لكتابة اسم.
 * ⚠️ الطابع (updated_at) بيتحدّث من رد الحفظ. «تجاهل وحدّث» بيعمل refresh،
 *    والصفحة بتركّب المحرر من جديد بـ key = الطابع.
 * ⚠️ الحساب نفسه في الداتابيز (zell_create_order) — هنا إعداد بس.
 */
export function InstallationEditor({ initial, groups }: { initial: InstallationRecord; groups: ShippingAreaGroup[] }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, groups))
  const draftRef = useRef(draft)
  draftRef.current = draft
  const stampRef = useRef<string | null>(initial.updatedAt)
  const [savedAreas, setSavedAreas] = useState<InstallationAreas>(initial.config.areas)
  const [bulk, setBulk] = useState<Record<string, string>>({})
  const [localError, setLocalError] = useState<string | null>(null)

  const busy = state === 'saving'
  const locked = !mutationsOn || busy

  const update = (change: (current: Draft) => Draft) => {
    setDraft(change)
    setLocalError(null)
    markDirty()
  }

  function toggleArea(governorate: string, area: string, on: boolean) {
    update((current) => {
      const list = { ...(current.areas[governorate] ?? {}) }
      if (on) list[area] = list[area] ?? ''
      else delete list[area]
      const areas = { ...current.areas }
      if (Object.keys(list).length > 0) areas[governorate] = list
      else delete areas[governorate]
      return { ...current, areas }
    })
  }

  function setTravel(governorate: string, area: string, text: string) {
    update((current) => ({
      ...current,
      areas: { ...current.areas, [governorate]: { ...(current.areas[governorate] ?? {}), [area]: text } },
    }))
  }

  function enableAll(governorate: string, areas: string[]) {
    const text = (bulk[governorate] ?? '').trim()
    if (toPiastres(text, 0) === null) {
      setLocalError('اكتب سعر انتقال صحيح لـ' + governorate + ' قبل «فعّل الكل» — صفر = مجاني')
      return
    }
    update((current) => ({ ...current, areas: { ...current.areas, [governorate]: Object.fromEntries(areas.map((area) => [area, text])) } }))
  }

  function disableAll(governorate: string) {
    update((current) => {
      const areas = { ...current.areas }
      delete areas[governorate]
      return { ...current, areas }
    })
  }

  function save() {
    const checked = validate(draftRef.current)
    if (!checked.ok) {
      setLocalError(checked.error)
      return
    }
    setLocalError(null)
    const input = checked.input
    const expected = stampRef.current
    void run(() => saveInstallationAction(input, expected), {
      onSuccess: (saved) => {
        stampRef.current = saved.updatedAt
        setSavedAreas(saved.config.areas)
        setDraft(toDraft(saved, groups))
      },
    })
  }

  const withAreas = groups.filter((group) => group.areas.length > 0)
  const withoutAreas = groups.filter((group) => group.areas.length === 0)
  const orphans = orphansOf(savedAreas, groups)
  const enabledAreas = Object.values(draft.areas).reduce((sum, list) => sum + Object.keys(list).length, 0)
  const enabledGovernorates = Object.keys(draft.areas).length
  const fee = toPiastres(draft.fee, 1)

  const status = !draft.enabled
    ? { tone: 'text-muted', text: 'متقفل — خيار الفني مش ظاهر للزبون.' }
    : fee === null
      ? { tone: 'text-gold', text: 'يُرجى إدخال سعر تركيب المتر؛ بدونه لا تتوفر خدمة التركيب في أي منطقة.' }
      : enabledAreas === 0
        ? { tone: 'text-gold', text: 'لا توجد منطقة مفعّلة، لذلك لا تتوفر خدمة التركيب في أي منطقة.' }
        : {
            tone: 'text-ok',
            text:
              'متاح في ' + String(enabledAreas) + ' منطقة في ' + String(enabledGovernorates) + ' محافظة — ' +
              formatPiastres(fee) + ' للمتر + انتقال حسب المنطقة.',
          }

  return (
    <div className="space-y-4">
      <Card title="الخدمة">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">تشغيل فني التركيب</p>
              <p className="text-xs text-muted">يظهر للعميل في المناطق المفعّلة أدناه فقط.</p>
            </div>
            <Switch
              checked={draft.enabled}
              onChange={(next) => update((current) => ({ ...current, enabled: next }))}
              label="تشغيل فني التركيب"
              disabled={locked}
            />
          </div>
          <p className={'border-t border-border pt-2 text-xs font-semibold ' + status.tone}>{status.text}</p>

          <Field
            htmlFor="installation-fee"
            label="سعر تركيب المتر الطولي (ج.م)"
            hint={
              'يُحسب على مجموع أطوال المنتجات المبيعة بالمقاس في الطلب، ولا تدخل فيه المنتجات المبيعة بالعدد.' +
              (fee === null ? '' : ' مثال: فيلم 5 متر = ' + formatPiastres(fee * 5) + ' تركيب.')
            }
          >
            <input
              id="installation-fee"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={draft.fee}
              onChange={(event) => update((current) => ({ ...current, fee: event.target.value }))}
              className={inputClasses}
              placeholder="100"
              disabled={locked}
            />
          </Field>

          <Field htmlFor="installation-note" label="سطر التوضيح (اختياري)" hint="بيظهر تحت خيار الفني في صفحة الطلب.">
            <textarea
              id="installation-note"
              value={draft.note}
              onChange={(event) => update((current) => ({ ...current, note: event.target.value }))}
              className={textareaClasses}
              rows={2}
              maxLength={INSTALLATION_LIMITS.note}
              placeholder="اكتب سطر التوضيح"
              disabled={locked}
            />
          </Field>
        </div>
      </Card>

      {orphans.length > 0 ? (
        <div className="rounded-lg border-2 border-gold bg-gold/10 p-3 text-xs text-fg">
          <p className="font-bold">مناطق كانت متاحة للفني ومابقتش موجودة في الشحن</p>
          <p className="mt-1">{orphans.join('، ')}</p>
          <p className="mt-1 text-muted">
            حُذفت أو تغيّر اسمها في صفحة الشحن، لذلك خدمة التركيب غير متاحة فيها حاليًا. ستُزال من هنا عند الحفظ التالي، وإذا تغيّر الاسم يُرجى تفعيل الاسم الجديد أدناه.
          </p>
        </div>
      ) : null}

      {withAreas.length === 0 ? (
        <Card title="المناطق">
          <p className="text-xs text-muted">
            مفيش مناطق في إعدادات الشحن. ضيف مناطق كل محافظة من{' '}
            <Link href="/shipping" className="font-semibold text-accent">
              صفحة الشحن
            </Link>{' '}
            الأول، وبعدين فعّلها هنا.
          </p>
        </Card>
      ) : null}

      {withAreas.map((group, groupIndex) => {
        const list = draft.areas[group.governorate] ?? {}
        const active = Object.keys(list).length
        const bulkId = 'installation-bulk-' + String(groupIndex)
        return (
          <Card key={group.governorate} title={group.governorate + ' (' + String(active) + '/' + String(group.areas.length) + ')'}>
            {group.shippingDisabled ? (
              <p className="mb-2 text-xs font-semibold text-gold">
                الشحن لهذه المحافظة متوقف، وتُرفض الطلبات منها حتى يُعاد تشغيله من صفحة الشحن.
              </p>
            ) : null}
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <Field htmlFor={bulkId} label="فعّل كل المناطق بانتقال (ج.م)">
                <input
                  id={bulkId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={bulk[group.governorate] ?? ''}
                  onChange={(event) => setBulk((current) => ({ ...current, [group.governorate]: event.target.value }))}
                  className={inputClasses + ' w-32'}
                  placeholder="0"
                  disabled={locked}
                />
              </Field>
              <Button variant="secondary" size="sm" disabled={locked} onClick={() => enableAll(group.governorate, group.areas)}>
                فعّل الكل
              </Button>
              <Button variant="ghost" size="sm" disabled={locked || active === 0} onClick={() => disableAll(group.governorate)}>
                اقفل الكل
              </Button>
            </div>
            <ul className="divide-y divide-border">
              {group.areas.map((area, areaIndex) => {
                const travel = list[area]
                const on = travel !== undefined
                const travelId = 'installation-travel-' + String(groupIndex) + '-' + String(areaIndex)
                return (
                  <li key={area} className="flex flex-wrap items-center gap-3 py-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(event) => toggleArea(group.governorate, area, event.target.checked)}
                        disabled={locked}
                        className="h-4 w-4 shrink-0 accent-brand"
                      />
                      <span className="truncate">{area}</span>
                    </label>
                    {on ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          id={travelId}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={travel}
                          onChange={(event) => setTravel(group.governorate, area, event.target.value)}
                          className={inputClasses + ' w-28'}
                          placeholder="0"
                          aria-label={'انتقال الفني لـ' + area}
                          disabled={locked}
                        />
                        <span className="text-xs text-muted">ج انتقال</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">مش متاح</span>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-xs text-muted">الانتقال بيتحسب مرة واحدة للطلب مهما كان عدد الأفلام — صفر = مجاني.</p>
          </Card>
        )
      })}

      {withoutAreas.length > 0 && withAreas.length > 0 ? (
        <p className="text-xs text-muted">
          محافظات من غير مناطق في الشحن (الفني مش متاح فيها): {withoutAreas.map((group) => group.governorate).join('، ')} — ضيف
          مناطقها من{' '}
          <Link href="/shipping" className="font-semibold text-accent">
            صفحة الشحن
          </Link>
          .
        </p>
      ) : null}

      {localError ? <p className="text-sm font-semibold text-danger">{localError}</p> : null}
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      <SaveBar state={state} onSave={save} warning={warning} />
    </div>
  )
}
