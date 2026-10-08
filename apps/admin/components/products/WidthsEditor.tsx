'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { saveProductWidthsAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { formatPiastres, piastresToPounds, poundsToPiastres } from '../../lib/format'
import type { AdminWidth } from '../../lib/data/productWidths'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, inputClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'

type Draft = { key: string; width: string; price: string; compare: string; isActive: boolean }

let counter = 0
const nextKey = () => 'w' + String((counter += 1))

function toDraft(width: AdminWidth): Draft {
  return {
    key: nextKey(),
    width: String(width.widthCm),
    price: piastresToPounds(width.pricePerMeterPiastres),
    compare: width.compareAtPiastres ? piastresToPounds(width.compareAtPiastres) : '',
    isActive: width.isActive,
  }
}

/**
 * عروض الرول — 0015. العرض الأساسي من «السعر والمقاسات»، والعروض التانية
 * هنا كل واحد بسعر المتر بتاعه. الزبون بيختار من «غيّر العرض» في صفحة المنتج.
 */
export function WidthsEditor({
  productId,
  baseWidthCm,
  basePricePiastres,
  initial,
}: {
  productId: number
  baseWidthCm: number
  basePricePiastres: number
  initial: AdminWidth[]
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [rows, setRows] = useState<Draft[]>(() => initial.map(toDraft))
  const [showErrors, setShowErrors] = useState(false)

  const change = (key: string, patch: Partial<Draft>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    markDirty()
  }

  const add = () => {
    setRows((current) => [...current, { key: nextKey(), width: '', price: '', compare: '', isActive: true }])
    markDirty()
  }

  const remove = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key))
    markDirty()
  }

  const move = (index: number, delta: -1 | 1) => {
    setRows((current) => {
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

  /** نفس قواعد السيرفر — عشان الغلط يبان جنب الخانة قبل الحفظ. */
  function problemOf(row: Draft, index: number): string | null {
    const width = Number(row.width)
    if (row.width.trim() === '' || !Number.isInteger(width) || width <= 0 || width > 1000) return 'اكتب العرض بالسنتيمتر (رقم صحيح)'
    if (width === baseWidthCm) return 'ده العرض الأساسي — مش محتاج يتضاف هنا'
    if (rows.some((other, otherIndex) => otherIndex !== index && Number(other.width) === width)) return 'العرض ده متكرر'
    const price = poundsToPiastres(row.price)
    if (row.price.trim() === '' || price <= 0) return 'اكتب سعر المتر'
    if (row.compare.trim() !== '' && poundsToPiastres(row.compare) <= price) return 'السعر قبل الخصم لازم يكون أكبر من سعر المتر'
    return null
  }

  const problems = rows.map((row, index) => problemOf(row, index))
  const hasProblems = problems.some((problem) => problem !== null)

  function save() {
    if (hasProblems) {
      setShowErrors(true)
      return
    }
    const payload: AdminWidth[] = rows.map((row) => ({
      widthCm: Number(row.width),
      pricePerMeterPiastres: poundsToPiastres(row.price),
      compareAtPiastres: row.compare.trim() === '' ? null : poundsToPiastres(row.compare),
      isActive: row.isActive,
    }))
    void run(() => saveProductWidthsAction(productId, payload), {
      onSuccess: (saved) => {
        setRows(saved.map(toDraft))
        setShowErrors(false)
        router.refresh()
      },
    })
  }

  return (
    <Card title={'عروض الرول (' + String(rows.length + 1) + ')'}>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          لو المنتج ليه أكتر من عرض رول، ضيف العروض التانية هنا وكل واحد بسعر المتر بتاعه. الزبون بيختار العرض من زرار
          «غيّر العرض» في صفحة المنتج، والأوردر بيتحسب بسعر العرض اللي اختاره. منتج بعرض واحد = سيب القايمة فاضية.
        </p>

        <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-bg p-2.5 text-sm">
          <span className="font-semibold text-fg">{'العرض الأساسي: ' + String(baseWidthCm) + ' سم'}</span>
          <span className="text-muted">{'· ' + formatPiastres(basePricePiastres) + ' للمتر'}</span>
          <span className="ms-auto text-xs text-muted">بيتعدّل من «السعر والمقاسات» فوق</span>
        </div>

        {rows.length === 0 ? (
          <p className="rounded border border-dashed border-border p-3 text-xs text-muted">مفيش عروض إضافية — المنتج بعرض واحد.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row, index) => {
              const problem = showErrors ? problems[index] : null
              return (
                <li key={row.key} className="rounded border border-border p-2.5">
                  <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                    <label className="block text-xs text-muted">
                      العرض (سم)
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={row.width}
                        onChange={(e) => change(row.key, { width: e.target.value })}
                        className={inputClasses + ' mt-1'}
                        placeholder="100"
                        disabled={!mutationsOn}
                      />
                    </label>
                    <label className="block text-xs text-muted">
                      سعر المتر (ج.م)
                      <input
                        type="number"
                        min={0}
                        value={row.price}
                        onChange={(e) => change(row.key, { price: e.target.value })}
                        className={inputClasses + ' mt-1'}
                        placeholder="280"
                        disabled={!mutationsOn}
                      />
                    </label>
                    <label className="block text-xs text-muted">
                      قبل الخصم (اختياري)
                      <input
                        type="number"
                        min={0}
                        value={row.compare}
                        onChange={(e) => change(row.key, { compare: e.target.value })}
                        className={inputClasses + ' mt-1'}
                        placeholder="فاضي = مفيش خصم"
                        disabled={!mutationsOn}
                      />
                    </label>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" aria-label="لفوق" disabled={!mutationsOn || index === 0} onClick={() => move(index, -1)}>
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="لتحت"
                        disabled={!mutationsOn || index === rows.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="امسح العرض" disabled={!mutationsOn} onClick={() => remove(row.key)} className="text-danger">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg">
                    <Switch
                      checked={row.isActive}
                      onChange={(next) => change(row.key, { isActive: next })}
                      disabled={!mutationsOn}
                      label="العرض شغّال"
                    />
                    {row.isActive ? 'شغّال — بيظهر للزبون' : 'متوقف — مش بيظهر للزبون'}
                    {problem ? <span className="ms-auto font-medium text-danger">{problem}</span> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <Button variant="secondary" size="sm" disabled={!mutationsOn || rows.length >= 10} onClick={add}>
          <Plus className="h-4 w-4" />
          ضيف عرض
        </Button>

        {showErrors && hasProblems ? (
          <p className="text-xs font-medium text-danger">صلّح الخانات اللي عليها ملاحظة وبعدين احفظ.</p>
        ) : null}

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
        <SaveBar state={state} onSave={save} warning={warning} />
      </div>
    </Card>
  )
}
