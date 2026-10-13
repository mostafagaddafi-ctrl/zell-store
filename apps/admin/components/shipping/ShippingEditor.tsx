'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, MapPin, Plus, Trash2, X } from 'lucide-react'
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

type Areas = Record<string, string[]>

/** نفس حدود السيرفر (validation/settings + mutations/shippingAreas). */
const MAX_GOVERNORATES = 60
const MAX_NAME = 60
const MAX_AREA = 40

/** «أكتوبر، الشيخ زايد» أو سطر لكل منطقة — الاتنين شغالين. */
function splitAreas(text: string): string[] {
  return text
    .split(/[،,\n]/)
    .map((item) => item.trim().slice(0, MAX_AREA))
    .filter((item) => item !== '')
}

/**
 * الشحن: القواعد العامة + كل محافظة (سعر · تفعيل · ترتيب · مناطق) + إضافة ومسح.
 *
 * الترتيب هنا = ترتيب القايمة في صفحة الطلب وصفحة فني التركيب.
 * المناطق اختيار سريع للزبون بعد المحافظة، والسعر بالمحافظة زي ما هو.
 *
 * ⚠️ قايمة كروت مش جدول: الجدول كان بيعمل سكرول جانبي على الموبايل.
 */
export function ShippingEditor({
  shipping,
  order,
  areas,
  installerAreas = {},
}: {
  shipping: ShippingSettings
  order: string[]
  areas: Areas
  /** مناطق متاحة لفني التركيب (من settings.installation) — للتحذير بس. */
  installerAreas?: Areas
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState(shipping)
  const [sequence, setSequence] = useState<string[]>(() => orderGovernorates(Object.keys(shipping.rates), order))
  const [areaDraft, setAreaDraft] = useState<Areas>(areas)
  const [openAreas, setOpenAreas] = useState<string | null>(null)
  const [areaInput, setAreaInput] = useState('')
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const touch = (next: ShippingSettings) => {
    setDraft(next)
    markDirty()
  }

  /** «حاول تاني» لازم تبعت أحدث نسخة مش نسخة من وقت الضغط الأول. */
  const draftRef = useRef(draft)
  draftRef.current = draft
  const sequenceRef = useRef(sequence)
  sequenceRef.current = sequence
  const areaRef = useRef(areaDraft)
  areaRef.current = areaDraft

  const [syncedAt, setSyncedAt] = useState(shipping.updatedAt)
  useEffect(() => {
    if (shipping.updatedAt === syncedAt) return
    setSyncedAt(shipping.updatedAt)
    setDraft(shipping)
    setSequence(orderGovernorates(Object.keys(shipping.rates), order))
    setAreaDraft(areas)
  }, [shipping, syncedAt, order, areas])

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

  function addGovernorate() {
    const name = newName.trim().replace(/\s+/g, ' ')
    const price = Math.round(Number(newPrice) * 100)
    if (name === '') {
      setAddError('اكتب اسم المحافظة')
      return
    }
    if (name.length > MAX_NAME) {
      setAddError('الاسم أطول من ' + String(MAX_NAME) + ' حرف')
      return
    }
    if (draft.rates[name] !== undefined) {
      setAddError('المحافظة دي موجودة بالفعل')
      return
    }
    if (Object.keys(draft.rates).length >= MAX_GOVERNORATES) {
      setAddError('وصلت لأقصى عدد محافظات (' + String(MAX_GOVERNORATES) + ')')
      return
    }
    if (newPrice.trim() === '' || !Number.isFinite(price) || price < 0) {
      setAddError('اكتب سعر شحن صحيح')
      return
    }
    setAddError(null)
    touch({ ...draft, rates: { ...draft.rates, [name]: price } })
    setSequence((current) => [...current, name])
    setNewName('')
    setNewPrice('')
  }

  function removeGovernorate(name: string) {
    const installer = (installerAreas[name] ?? []).length > 0
    const sure = window.confirm(
      'هل تريد حذف «' + name + '» من الشحن؟ لن يتمكن العملاء من اختيارها، ولن تتأثر الطلبات السابقة.' +
        (installer ? ' تحتوي على مناطق متاحة لفني التركيب، وستتوقف خدمة التركيب فيها.' : ''),
    )
    if (!sure) return
    const rates = { ...draft.rates }
    delete rates[name]
    touch({ ...draft, rates, disabled: draft.disabled.filter((item) => item !== name) })
    setSequence((current) => current.filter((item) => item !== name))
    setAreaDraft((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
    if (openAreas === name) setOpenAreas(null)
  }

  function addAreas(governorate: string) {
    const incoming = splitAreas(areaInput)
    if (incoming.length === 0) return
    setAreaDraft((current) => {
      const merged = [...(current[governorate] ?? [])]
      for (const item of incoming) if (!merged.includes(item)) merged.push(item)
      return { ...current, [governorate]: merged }
    })
    setAreaInput('')
    markDirty()
  }

  function removeArea(governorate: string, area: string) {
    if ((installerAreas[governorate] ?? []).includes(area)) {
      const sure = window.confirm(
        '«' + area + '» متاحة لفني التركيب. عند حذفها أو تغيير اسمها لن تتوفر خدمة التركيب فيها حتى يُعاد تفعيلها من صفحة فني التركيب. هل تريد المتابعة؟',
      )
      if (!sure) return
    }
    setAreaDraft((current) => ({ ...current, [governorate]: (current[governorate] ?? []).filter((item) => item !== area) }))
    markDirty()
  }

  function toggleAreas(governorate: string) {
    setOpenAreas((current) => (current === governorate ? null : governorate))
    setAreaInput('')
  }

  // مناطق الفني اللي هتتشال من الشحن لو اتحفظ التعديل ده (مسح أو تغيير اسم)
  const lostInstaller: string[] = []
  for (const [governorate, list] of Object.entries(installerAreas)) {
    const current = governorate in draft.rates ? (areaDraft[governorate] ?? []) : []
    for (const area of list) if (!current.includes(area)) lostInstaller.push(area + ' (' + governorate + ')')
  }

  function save() {
    void run(
      () => saveShippingAction(draftRef.current, draftRef.current.updatedAt, sequenceRef.current, areaRef.current),
      { onSuccess: () => router.refresh() },
    )
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

      <Card title={'المحافظات (' + String(sequence.length) + ')'}>
        <p className="mb-3 text-xs text-muted">
          يطابق هذا الترتيب ترتيب القائمة في صفحة الطلب، ويُفضَّل وضع الأهم في الأعلى. وتظهر «المناطق» للعميل بعد اختيار المحافظة لتسهيل الاختيار بدل الكتابة.
        </p>
        <ul className="space-y-2">
          {sequence.map((name, index) => {
            const value = draft.rates[name] ?? 0
            const enabled = !draft.disabled.includes(name)
            const list = areaDraft[name] ?? []
            const isOpen = openAreas === name
            return (
              <li key={name} className="rounded border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 shrink-0 text-center text-xs font-bold tabular-nums text-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{name}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={'حرّك ' + name + ' لفوق'}
                      disabled={!mutationsOn || index === 0}
                      onClick={() => move(index, -1)}
                    >
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
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={'امسح ' + name}
                      disabled={!mutationsOn}
                      onClick={() => removeGovernorate(name)}
                      className="text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
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

                <div className="mt-2 ps-8">
                  <button
                    type="button"
                    onClick={() => toggleAreas(name)}
                    aria-expanded={isOpen}
                    className="inline-flex items-center gap-1.5 rounded px-1 py-1 text-xs font-semibold text-brand hover:underline"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {list.length > 0 ? 'المناطق (' + String(list.length) + ')' : 'ضيف مناطق'}
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {!isOpen && list.length > 0 ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">{list.join('، ')}</p>
                  ) : null}

                  {isOpen ? (
                    <div className="mt-2 space-y-2 rounded border border-border bg-bg p-2.5">
                      {list.length === 0 ? (
                        <p className="text-xs text-muted">مفيش مناطق. الزبون هيكتب منطقته في العنوان.</p>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {list.map((area) => (
                            <li
                              key={area}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-1 pe-1.5 ps-2.5 text-xs text-fg"
                            >
                              {area}
                              {(installerAreas[name] ?? []).includes(area) ? (
                                <span className="rounded bg-accent/10 px-1 text-[10px] font-bold text-accent">فني</span>
                              ) : null}
                              <button
                                type="button"
                                aria-label={'امسح ' + area}
                                disabled={!mutationsOn}
                                onClick={() => removeArea(name, area)}
                                className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-border/60 hover:text-fg"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={areaInput}
                          onChange={(e) => setAreaInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addAreas(name)
                            }
                          }}
                          placeholder="مثلًا: أكتوبر، الشيخ زايد، الهرم"
                          className={inputClasses + ' min-w-0 flex-1'}
                          aria-label={'مناطق ' + name}
                          disabled={!mutationsOn}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!mutationsOn || areaInput.trim() === ''}
                          onClick={() => addAreas(name)}
                          className="max-sm:h-10"
                        >
                          <Plus className="h-4 w-4" />
                          إضافة
                        </Button>
                      </div>
                      <p className="text-xs text-muted">يمكن إدخال عدة مناطق دفعة واحدة مع الفصل بينها بفاصلة، ثم الضغط على «حفظ» أدناه.</p>
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card title="إضافة محافظة">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
          <Field htmlFor="new-governorate" label="اسم المحافظة">
            <input
              id="new-governorate"
              value={newName}
              maxLength={MAX_NAME}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="مثلًا: العاشر من رمضان"
              className={inputClasses}
              disabled={!mutationsOn}
            />
          </Field>
          <Field htmlFor="new-governorate-price" label="سعر الشحن (ج.م)">
            <input
              id="new-governorate-price"
              type="number"
              min={0}
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="50"
              className={inputClasses}
              disabled={!mutationsOn}
            />
          </Field>
          <Button variant="secondary" disabled={!mutationsOn} onClick={addGovernorate}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        </div>
        {addError ? <p className="mt-2 text-xs font-medium text-danger">{addError}</p> : null}
        <p className="mt-2 text-xs text-muted">بتتضاف آخر القايمة — حرّكها بالأسهم ودوس «حفظ».</p>
      </Card>

      {lostInstaller.length > 0 ? (
        <div className="rounded-lg border-2 border-gold bg-gold/10 p-3 text-xs text-fg">
          <p className="font-bold">مناطق متاحة لفني التركيب هتتشال من الشحن</p>
          <p className="mt-1">{lostInstaller.join('، ')}</p>
          <p className="mt-1 text-muted">
            بعد الحفظ لن تتوفر خدمة التركيب فيها. وعند تغيير الاسم يُرجى تفعيل الاسم الجديد من صفحة فني التركيب.
          </p>
        </div>
      ) : null}
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      <SaveBar state={state} onSave={save} warning={warning} />
    </div>
  )
}
