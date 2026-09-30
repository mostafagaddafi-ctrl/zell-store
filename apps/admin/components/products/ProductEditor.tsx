'use client'

import { useState } from 'react'
import { computeSubtotalPiastres, validateRules } from '@zell/core'
import type { AdminProductDetail, SaveState } from '../../lib/adminData'
import { formatLength, formatPiastres, piastresToPounds, poundsToPiastres } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { ImageManager } from './ImageManager'

type Tab = 'details' | 'pricing' | 'images'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'details', label: 'بيانات' },
  { key: 'pricing', label: 'تسعير ومقاسات' },
  { key: 'images', label: 'صور' },
]

const EMPTY = {
  nameAr: '',
  nameEn: '',
  descriptionAr: '',
  shortBenefit: '',
  benefits: [] as string[],
  pricePounds: '0',
  widthCm: '50',
  minLengthCm: '300',
  stepCm: '50',
  maxLengthCm: '3000',
}

export function ProductEditor({ product }: { product: AdminProductDetail | null }) {
  const [tab, setTab] = useState<Tab>('details')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const [form, setForm] = useState(
    product
      ? {
          nameAr: product.nameAr,
          nameEn: product.nameEn,
          descriptionAr: product.descriptionAr,
          shortBenefit: product.shortBenefit,
          benefits: product.benefits,
          pricePounds: piastresToPounds(product.pricePerMeterPiastres),
          widthCm: String(product.widthCm),
          minLengthCm: String(product.minLengthCm),
          stepCm: String(product.stepCm),
          maxLengthCm: String(product.maxLengthCm),
        }
      : EMPTY,
  )

  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch })
    setSaveState('dirty')
  }

  const rules = {
    price_per_meter_piastres: poundsToPiastres(form.pricePounds),
    min_length_cm: Number(form.minLengthCm),
    step_cm: Number(form.stepCm),
    max_length_cm: Number(form.maxLengthCm),
    width_cm: Number(form.widthCm),
  }
  const rulesCheck = validateRules(rules)

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
              tab === item.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'details' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="الأساسيات">
            <div className="space-y-3">
              <Field htmlFor="nameAr" label="الاسم بالعربي">
                <input id="nameAr" value={form.nameAr} onChange={(e) => set({ nameAr: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="nameEn" label="الاسم بالإنجليزي" hint="اختياري — بيظهر تحت الاسم في صفحة المنتج">
                <input id="nameEn" value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} className={inputClasses} dir="ltr" />
              </Field>
              <Field htmlFor="desc" label="الوصف">
                <textarea id="desc" value={form.descriptionAr} onChange={(e) => set({ descriptionAr: e.target.value })} className={textareaClasses} />
              </Field>
            </div>
          </Card>

          <Card title="نصوص العرض">
            <div className="space-y-3">
              <Field
                htmlFor="benefit"
                label="الفائدة المختصرة"
                hint={'بتظهر في كارت المنتج · ' + String(form.shortBenefit.length) + '/180'}
                error={form.shortBenefit.length > 180 ? 'أطول من الحد المسموح' : undefined}
              >
                <input id="benefit" value={form.shortBenefit} onChange={(e) => set({ shortBenefit: e.target.value })} className={inputClasses} />
              </Field>

              <Field label="المميزات" hint="بتظهر في صفحة المنتج — ٦ كحد أقصى، كل واحدة ١٤٠ حرف">
                <div className="space-y-2">
                  {form.benefits.map((point, index) => (
                    <input
                      key={index}
                      value={point}
                      onChange={(e) => {
                        const next = [...form.benefits]
                        next[index] = e.target.value
                        set({ benefits: next })
                      }}
                      className={inputClasses}
                      aria-label={'ميزة رقم ' + String(index + 1)}
                    />
                  ))}
                  {form.benefits.length === 0 ? <p className="text-xs text-muted">مفيش مميزات مسجّلة.</p> : null}
                </div>
              </Field>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'pricing' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="السعر والمقاسات">
            <div className="grid grid-cols-2 gap-3">
              <Field htmlFor="price" label="سعر المتر (ج.م)">
                <input id="price" type="number" min={0} value={form.pricePounds} onChange={(e) => set({ pricePounds: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="width" label="عرض الرول (سم)">
                <input id="width" type="number" min={1} value={form.widthCm} onChange={(e) => set({ widthCm: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="min" label="أقل طول (سم)">
                <input id="min" type="number" min={1} value={form.minLengthCm} onChange={(e) => set({ minLengthCm: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="step" label="خطوة الزيادة (سم)">
                <input id="step" type="number" min={1} value={form.stepCm} onChange={(e) => set({ stepCm: e.target.value })} className={inputClasses} />
              </Field>
              <Field htmlFor="max" label="أقصى طول (سم)" className="col-span-2">
                <input id="max" type="number" min={1} value={form.maxLengthCm} onChange={(e) => set({ maxLengthCm: e.target.value })} className={inputClasses} />
              </Field>
            </div>

            {!rulesCheck.ok ? (
              <p className="mt-3 rounded border border-danger/40 bg-danger/5 p-2 text-xs font-medium text-danger">
                {rulesCheck.message}
              </p>
            ) : null}
          </Card>

          <Card title="معاينة الحساب">
            <p className="text-xs text-muted">
              نفس دوال التسعير اللي بتحسب للزبون في المتجر — لو الرقم هنا صح، هو صح عنده.
            </p>
            <dl className="mt-3 divide-y divide-border">
              {[rules.min_length_cm, rules.min_length_cm + rules.step_cm * 2, rules.max_length_cm].map((length) => (
                <div key={length} className="flex items-center justify-between py-2 text-sm">
                  <dt className="text-muted">{formatLength(length)}</dt>
                  <dd className="font-semibold text-fg">
                    {formatPiastres(computeSubtotalPiastres(rules.price_per_meter_piastres, length))}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      ) : null}

      {tab === 'images' ? <ImageManager images={product?.images ?? []} /> : null}

      <SaveBar state={saveState} />
    </div>
  )
}
