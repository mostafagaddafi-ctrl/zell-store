'use client'

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { computeSubtotalPiastres, validateRules } from '@zell/core'
import type { AdminWidth } from '../../lib/data/productWidths'
import { formatLength, formatPiastres, piastresToPounds, poundsToPiastres } from '../../lib/format'
import { Button } from '../ui/Button'
import { Card, Field, inputClasses } from '../ui/Field'
import { Switch } from '../ui/Switch'

/**
 * تاب «التسعير والعروض» — قايمة واحدة لكل عروض الرول بنفس الشكل.
 *
 * أول صف = العرض الأساسي (products.width_cm وسعره وخصمه)، والباقي
 * product_widths. الترتيب بالأسهم: أي صف يطلع أول بيبقى هو الأساسي.
 * الحفظ واحد من ProductEditor: المنتج الأول وبعده العروض.
 */
export type WidthDraft = { key: string; width: string; price: string; compare: string; isActive: boolean }

let counter = 0
export const newWidthKey = (): string => 'w' + String((counter += 1))

export function toWidthDraft(width: AdminWidth): WidthDraft {
  return {
    key: newWidthKey(),
    width: String(width.widthCm),
    price: piastresToPounds(width.pricePerMeterPiastres),
    compare: width.compareAtPiastres ? piastresToPounds(width.compareAtPiastres) : '',
    isActive: width.isActive,
  }
}

export type PricingForm = {
  pricePounds: string
  widthCm: string
  comparePounds: string
  lockWidth: boolean
  minLengthCm: string
  stepCm: string
  maxLengthCm: string
  extraWidths: WidthDraft[]
}

type Row = WidthDraft & { base: boolean }

function rowsOf(form: PricingForm): Row[] {
  return [
    { key: 'base', width: form.widthCm, price: form.pricePounds, compare: form.comparePounds, isActive: true, base: true },
    ...form.extraWidths.map((row) => ({ ...row, base: false })),
  ]
}

function patchFromRows(rows: Row[]): Partial<PricingForm> {
  const [first, ...rest] = rows
  if (!first) return {}
  return {
    widthCm: first.width,
    pricePounds: first.price,
    comparePounds: first.compare,
    extraWidths: rest.map((row) => ({
      key: row.base ? newWidthKey() : row.key,
      width: row.width,
      price: row.price,
      compare: row.compare,
      isActive: row.isActive,
    })),
  }
}

/** نفس قواعد السيرفر — الغلط بيبان جنب الصف قبل الحفظ. */
export function rowProblems(form: PricingForm): Array<string | null> {
  const rows = rowsOf(form)
  return rows.map((row, index) => {
    const width = Number(row.width)
    if (row.width.trim() === '' || !Number.isInteger(width) || width <= 0 || width > 1000) {
      return 'اكتب العرض بالسنتيمتر (رقم صحيح)'
    }
    if (rows.some((other, otherIndex) => otherIndex !== index && Number(other.width) === width)) return 'العرض ده متكرر'
    const price = poundsToPiastres(row.price)
    if (row.price.trim() === '' || price <= 0) return 'اكتب سعر المتر'
    if (row.compare.trim() !== '' && poundsToPiastres(row.compare) <= price) {
      return 'السعر قبل الخصم لازم يكون أكبر من سعر المتر'
    }
    return null
  })
}

export function pricingProblem(form: PricingForm): string | null {
  return rowProblems(form).find((problem) => problem !== null) ?? null
}

export function extraWidthsPayload(form: PricingForm): AdminWidth[] {
  return form.extraWidths.map((row) => ({
    widthCm: Number(row.width),
    pricePerMeterPiastres: poundsToPiastres(row.price),
    compareAtPiastres: row.compare.trim() === '' ? null : poundsToPiastres(row.compare),
    isActive: row.isActive,
  }))
}

export function PricingFields({
  form,
  set,
  showErrors,
}: {
  form: PricingForm
  set: (patch: Partial<PricingForm>) => void
  showErrors: boolean
}) {
  const rows = rowsOf(form)
  const problems = rowProblems(form)

  const update = (index: number, patch: Partial<WidthDraft>) =>
    set(patchFromRows(rows.map((row, position) => (position === index ? { ...row, ...patch } : row))))

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    const a = rows[index]
    const b = rows[target]
    if (a === undefined || b === undefined) return
    const next = [...rows]
    next[index] = b
    next[target] = a
    set(patchFromRows(next))
  }

  const remove = (index: number) => {
    if (rows.length < 2) return
    set(patchFromRows(rows.filter((_, position) => position !== index)))
  }

  const add = () =>
    set({ extraWidths: [...form.extraWidths, { key: newWidthKey(), width: '', price: '', compare: '', isActive: true }] })

  /** خصم سريع على كل العروض: الأساس = السعر قبل الخصم لو موجود، وإلا السعر الحالي. */
  const discountAll = (percent: number) =>
    set(
      patchFromRows(
        rows.map((row) => {
          const base = row.compare.trim() !== '' ? Number(row.compare) : Number(row.price)
          if (!Number.isFinite(base) || base <= 0) return row
          return { ...row, compare: String(base), price: String(Math.max(1, Math.round(base * (1 - percent / 100)))) }
        }),
      ),
    )

  const removeDiscounts = () =>
    set(
      patchFromRows(
        rows.map((row) => (row.compare.trim() !== '' ? { ...row, price: row.compare, compare: '' } : row)),
      ),
    )

  const anyDiscount = rows.some((row) => row.compare.trim() !== '')
  const lengthRules = {
    price_per_meter_piastres: poundsToPiastres(form.pricePounds),
    min_length_cm: Number(form.minLengthCm),
    step_cm: Number(form.stepCm),
    max_length_cm: Number(form.maxLengthCm),
    width_cm: Number(form.widthCm),
  }
  const rulesCheck = validateRules(lengthRules)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={'عروض الرول والأسعار (' + String(rows.length) + ')'} className="lg:col-span-2">
        <div className="space-y-3">
          <p className="text-xs text-muted">
            كل عرض رول بسعر المتر بتاعه. أول واحد هو اللي بيظهر للزبون الأول — رتّبهم بالأسهم. لو فيه أكتر من عرض، الزبون
            بيختار من أزرار «عرض الرول» في صفحة المنتج، والأوردر بيتحسب بسعر العرض اللي اختاره.
          </p>

          <ul className="space-y-2">
            {rows.map((row, index) => {
              const problem = showErrors ? problems[index] : null
              const price = poundsToPiastres(row.price)
              const compare = row.compare.trim() === '' ? 0 : poundsToPiastres(row.compare)
              const percent = compare > price && price > 0 ? Math.round((1 - price / compare) * 100) : 0
              return (
                <li key={row.key} className={'rounded border p-2.5 ' + (index === 0 ? 'border-brand/50 bg-brand/5' : 'border-border')}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-fg">{index === 0 ? 'العرض الأساسي' : 'عرض ' + String(index + 1)}</span>
                    {percent > 0 ? (
                      <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-brand-fg">
                        {'خصم ' + String(percent) + '٪'}
                      </span>
                    ) : null}
                    <div className="ms-auto flex items-center gap-1">
                      <Button variant="ghost" size="sm" aria-label="لفوق" disabled={index === 0} onClick={() => move(index, -1)}>
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="لتحت" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="امسح العرض" disabled={rows.length < 2} onClick={() => remove(index)} className="text-danger">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <label className="block text-xs text-muted">
                      العرض (سم)
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={row.width}
                        onChange={(e) => update(index, { width: e.target.value })}
                        className={inputClasses + ' mt-1'}
                        placeholder="50"
                      />
                    </label>
                    <label className="block text-xs text-muted">
                      سعر المتر (ج.م)
                      <input
                        type="number"
                        min={0}
                        value={row.price}
                        onChange={(e) => update(index, { price: e.target.value })}
                        className={inputClasses + ' mt-1'}
                        placeholder="320"
                      />
                    </label>
                    <label className="block text-xs text-muted">
                      قبل الخصم
                      <input
                        type="number"
                        min={0}
                        value={row.compare}
                        onChange={(e) => update(index, { compare: e.target.value })}
                        className={inputClasses + ' mt-1'}
                        placeholder="فاضي = مفيش"
                      />
                    </label>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg">
                    {index === 0 ? (
                      <span className="text-muted">الأساسي شغّال دايمًا</span>
                    ) : (
                      <>
                        <Switch checked={row.isActive} onChange={(next) => update(index, { isActive: next })} disabled={false} label="العرض شغّال" />
                        {row.isActive ? 'شغّال — بيظهر للزبون' : 'متوقف — مش بيظهر للزبون'}
                      </>
                    )}
                    {problem ? <span className="ms-auto font-medium text-danger">{problem}</span> : null}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={rows.length >= 11} onClick={add}>
              <Plus className="h-4 w-4" />
              ضيف عرض
            </Button>
            <span className="ms-auto text-xs font-semibold text-fg">خصم سريع على الكل:</span>
            {[10, 15, 20, 25].map((percent) => (
              <Button key={percent} variant="secondary" size="sm" onClick={() => discountAll(percent)}>
                {String(percent) + '٪'}
              </Button>
            ))}
            {anyDiscount ? (
              <Button variant="ghost" size="sm" onClick={removeDiscounts}>
                شيل الخصم
              </Button>
            ) : null}
          </div>

          <label className="flex items-start gap-2 rounded border border-border p-2.5 text-xs text-fg">
            <input
              type="checkbox"
              checked={form.lockWidth}
              onChange={(e) => set({ lockWidth: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
            />
            <span>
              <span className="font-semibold">تثبيت العرض</span> — الزبون مايكتبش العرض، والخانة بتتقفل على عرض الرول اللي
              اختاره. بيكتب الارتفاع بس.
            </span>
          </label>

          {showErrors && problems.some((problem) => problem !== null) ? (
            <p className="text-xs font-medium text-danger">صلّح الصفوف اللي عليها ملاحظة وبعدين احفظ.</p>
          ) : null}
        </div>
      </Card>

      <Card title="قواعد الطول (لكل العروض)">
        <div className="grid grid-cols-2 gap-3">
          <Field htmlFor="min" label="أقل طول للطلب (سم)" hint={'= ' + formatLength(Number(form.minLengthCm))}>
            <input id="min" type="number" min={1} value={form.minLengthCm} onChange={(e) => set({ minLengthCm: e.target.value })} className={inputClasses} />
          </Field>
          <Field htmlFor="max" label="أقصى طول للطلب (سم)" hint={'= ' + formatLength(Number(form.maxLengthCm))}>
            <input id="max" type="number" min={1} value={form.maxLengthCm} onChange={(e) => set({ maxLengthCm: e.target.value })} className={inputClasses} />
          </Field>
          <Field
            htmlFor="step"
            label="التقريب كل (سم)"
            className="col-span-2"
            hint={'= ' + formatLength(Number(form.stepCm)) + ' — الطول بيتقرّب لأعلى بالمقدار ده (مثلًا ٥٠ = كل نص متر)'}
          >
            <input id="step" type="number" min={1} value={form.stepCm} onChange={(e) => set({ stepCm: e.target.value })} className={inputClasses} />
          </Field>
        </div>
        {rulesCheck.ok ? (
          <p className="mt-3 rounded border border-border bg-bg p-2 text-xs text-fg">
            {'الزبون يقدر يطلب من ' +
              formatLength(lengthRules.min_length_cm) +
              ' لحد ' +
              formatLength(lengthRules.max_length_cm) +
              '، والطول بيتقرّب لأعلى كل ' +
              formatLength(lengthRules.step_cm) +
              '.'}
          </p>
        ) : (
          <p className="mt-3 rounded border border-danger/40 bg-danger/5 p-2 text-xs font-medium text-danger">{rulesCheck.message}</p>
        )}
      </Card>

      <Card title="معاينة الحساب">
        <p className="text-xs text-muted">نفس دوال التسعير اللي بتحسب للزبون — لو الرقم هنا صح، هو صح عنده.</p>
        <div className="mt-3 space-y-3">
          {rows
            .filter((row, index) => index === 0 || row.isActive)
            .map((row) => {
              const price = poundsToPiastres(row.price)
              return (
                <div key={row.key}>
                  <p className="text-xs font-bold text-fg">{'عرض ' + (row.width || '—') + ' سم'}</p>
                  <dl className="divide-y divide-border">
                    {[lengthRules.min_length_cm, lengthRules.max_length_cm].map((length) => (
                      <div key={length} className="flex items-center justify-between py-1.5 text-sm">
                        <dt className="text-muted">{formatLength(length)}</dt>
                        <dd className="font-semibold text-fg">{formatPiastres(computeSubtotalPiastres(price, length))}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )
            })}
        </div>
      </Card>
    </div>
  )
}
