'use client'

import { Card, Field, inputClasses } from '../ui/Field'
import { Button } from '../ui/Button'
import { poundsToPiastres } from '../../lib/format'

/**
 * 0016 — نوع البيع + تسعير منتج القطعة (الإضافات وأي حاجة من غير مقاسات).
 * القطعة: السعر = سعر القطعة (نفس عمود سعر المتر)، والحساب السعر × العدد.
 */
export type SaleUnit = 'meter' | 'piece'

export type PieceForm = {
  pricePounds: string
  comparePounds: string
  maxQuantity: string
  isListed: boolean
}

export function pieceProblem(form: PieceForm): string | null {
  const price = poundsToPiastres(form.pricePounds)
  if (form.pricePounds.trim() === '' || price <= 0) return 'اكتب سعر القطعة'
  if (form.comparePounds.trim() !== '' && poundsToPiastres(form.comparePounds) <= price) {
    return 'السعر قبل الخصم لازم يكون أكبر من سعر القطعة'
  }
  const max = Number(form.maxQuantity)
  if (!Number.isInteger(max) || max < 1 || max > 999) return 'أقصى عدد لازم يكون من ١ لـ ٩٩٩'
  return null
}

export function SaleUnitSwitch({ value, onChange }: { value: SaleUnit; onChange: (next: SaleUnit) => void }) {
  const options: Array<{ key: SaleUnit; title: string; hint: string }> = [
    { key: 'meter', title: 'بالمتر', hint: 'أفلام — عرض رول وطول' },
    { key: 'piece', title: 'بالقطعة', hint: 'إضافات وأدوات — عدد' },
  ]
  return (
    <Card title="نوع البيع">
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const active = value === option.key
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.key)}
              className={
                'rounded border-2 p-2.5 text-right transition-colors ' +
                (active ? 'border-brand bg-brand/5' : 'border-border hover:border-muted')
              }
            >
              <span className="block text-sm font-bold text-fg">{option.title}</span>
              <span className="block text-xs text-muted">{option.hint}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

export function PiecePricing({
  form,
  set,
  showErrors,
}: {
  form: PieceForm
  set: (patch: Partial<PieceForm>) => void
  showErrors: boolean
}) {
  const problem = showErrors ? pieceProblem(form) : null
  const price = poundsToPiastres(form.pricePounds)
  const compare = form.comparePounds.trim() === '' ? 0 : poundsToPiastres(form.comparePounds)
  const percent = compare > price && price > 0 ? Math.round((1 - price / compare) * 100) : 0

  const discount = (value: number) => {
    const base = form.comparePounds.trim() !== '' ? Number(form.comparePounds) : Number(form.pricePounds)
    if (!Number.isFinite(base) || base <= 0) return
    set({ comparePounds: String(base), pricePounds: String(Math.max(1, Math.round(base * (1 - value / 100)))) })
  }

  return (
    <Card title="سعر القطعة">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field htmlFor="piece-price" label="سعر القطعة (ج.م)">
            <input
              id="piece-price"
              type="number"
              min={0}
              value={form.pricePounds}
              onChange={(e) => set({ pricePounds: e.target.value })}
              className={inputClasses}
              placeholder="50"
            />
          </Field>
          <Field htmlFor="piece-compare" label="قبل الخصم">
            <input
              id="piece-compare"
              type="number"
              min={0}
              value={form.comparePounds}
              onChange={(e) => set({ comparePounds: e.target.value })}
              className={inputClasses}
              placeholder="فاضي = مفيش"
            />
          </Field>
          <Field htmlFor="piece-max" label="أقصى عدد">
            <input
              id="piece-max"
              type="number"
              min={1}
              max={999}
              value={form.maxQuantity}
              onChange={(e) => set({ maxQuantity: e.target.value })}
              className={inputClasses}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-fg">خصم سريع:</span>
          {[10, 15, 20, 25].map((value) => (
            <Button key={value} variant="secondary" size="sm" onClick={() => discount(value)}>
              {String(value) + '٪'}
            </Button>
          ))}
          {form.comparePounds.trim() !== '' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ pricePounds: form.comparePounds, comparePounds: '' })}
            >
              شيل الخصم
            </Button>
          ) : null}
          {percent > 0 ? (
            <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-brand-fg">{'خصم ' + String(percent) + '٪'}</span>
          ) : null}
        </div>

        <label className="flex items-start gap-2 rounded border border-border p-2.5 text-xs text-fg">
          <input
            type="checkbox"
            checked={form.isListed}
            onChange={(e) => set({ isListed: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
          />
          <span>
            <span className="font-semibold">يظهر في قوايم المنتجات</span> — الرئيسية والأقسام و«كل المنتجات». اقفله لو ده
            إضافة بس بتظهر جوه صفحات الأفلام.
          </span>
        </label>

        <p className="rounded border border-border bg-bg p-2 text-xs text-fg">
          الزبون بيختار العدد (من ١ لـ {form.maxQuantity || '—'}) والسعر = سعر القطعة × العدد. عشان يظهر كإضافة مع فيلم،
          افتح الفيلم واختاره من كارت «الإضافات».
        </p>

        {problem ? <p className="text-xs font-medium text-danger">{problem}</p> : null}
      </div>
    </Card>
  )
}
