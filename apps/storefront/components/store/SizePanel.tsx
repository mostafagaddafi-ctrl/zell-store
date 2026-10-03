'use client'

import { useState } from 'react'
import { AlertTriangle, Lock, Maximize, Minus, Plus, Ruler } from 'lucide-react'
import {
  areRulesUsable,
  computeSubtotalPiastres,
  formatLength,
  formatPiastres,
  lengthOptions,
  requiredLength,
  widthOptionsOf,
  withWidth,
  type StoreProduct,
} from '@zell/core'
import { cn } from '../../lib/cn'
import { inputClasses } from '../ui/Field'
import { Num } from './Num'

type Mode = 'window' | 'length'

/**
 * اختيار المقاس — كارت واحد بالترتيب: عرض الرول ← المقاس ← النتيجة.
 *
 * القاعدة: «بتقيس بالسنتيمتر، وبتدفع بالمتر». أي حاجة بيكتبها الزبون
 * بالسم (المازورة)، والطول والسعر بالمتر وجنبه السم بين قوسين.
 *
 * العروض (0015): أزرار جوه نفس الكارت لو المنتج ليه أكتر من عرض. تغيير
 * العرض **بيحتفظ** بمقاس الشباك المكتوب وبيعيد الحساب على العرض الجديد
 * على طول — قبل كده الخانات كانت بتتمسح والطول بيفضل على العرض القديم.
 *
 * العرض المتثبّت (0013): خانة عرض الشباك مقفولة على العرض المختار.
 *
 * 🔒 سلوك محفوظ: لو المقاس أكبر من الحد المتاح بنقول كده صراحة
 * وبنمنع الإضافة للسلة. ممنوع القص الصامت للحد الأقصى.
 */
export function SizePanel({
  product,
  widthCm,
  onWidthChange,
  lengthCm,
  onLengthChange,
  onBlockedChange,
}: {
  /** المنتج الأساسي — العروض التانية بتتحسب منه. */
  product: StoreProduct
  /** العرض المختار. */
  widthCm: number
  onWidthChange: (next: number) => void
  lengthCm: number
  onLengthChange: (next: number) => void
  onBlockedChange: (blocked: boolean) => void
}) {
  const [mode, setMode] = useState<Mode>('window')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [strips, setStrips] = useState(0)
  const [neededCm, setNeededCm] = useState(0)

  const widths = widthOptionsOf(product)
  const current = withWidth(product, widthCm) ?? product
  const options = lengthOptions(current)
  const price = computeSubtotalPiastres(current.price_per_meter_piastres, lengthCm)
  const widthLocked = product.lock_width === true

  const block = (message: string | null) => {
    setError(message)
    onBlockedChange(message !== null)
  }

  /** الحساب دايمًا على العرض اللي جاي في النداء — مش على قيمة render قديمة. */
  const applyWindow = (rules: StoreProduct, nextWidth: string, nextHeight: string) => {
    if (nextWidth.trim() === '' || nextHeight.trim() === '') {
      setStrips(0)
      setNeededCm(0)
      block(null)
      return
    }

    const result = requiredLength(Number(nextWidth), Number(nextHeight), rules)

    if (!result.ok) {
      setStrips(0)
      setNeededCm(0)
      // وإحنا بنكتب لسه ما نزعّقش — بس المقاس الكبير لازم يتقال بوضوح
      block(result.code === 'invalid_input' ? null : result.message)
      return
    }

    setStrips(result.strips)
    setNeededCm(result.neededCm)
    block(null)
    onLengthChange(result.lengthCm)
  }

  const windowWidthFor = (rules: StoreProduct) => (widthLocked ? String(rules.width_cm) : width)

  const pickWidth = (next: number) => {
    const rules = withWidth(product, next)
    if (!rules) return
    onWidthChange(next)
    if (mode === 'window') applyWindow(rules, windowWidthFor(rules), height)
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    if (next === 'length') block(null)
    else applyWindow(current, windowWidthFor(current), height)
  }

  const stepBy = (delta: number) => {
    const next = lengthCm + delta * current.step_cm
    if (next < current.min_length_cm || next > current.max_length_cm) return
    onLengthChange(next)
  }

  if (!areRulesUsable(current)) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-card p-4 text-sm text-danger">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        بيانات المنتج ده مش مكتملة دلوقتي. كلّمنا على واتساب ونساعدك.
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 className="text-base font-bold text-fg">حدد المقاس</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        قيس المكان اللي هيتركّب عليه الفيلم — شباك، باب، قزاز، مراية — بالسنتيمتر، وإحنا نحسب كام متر محتاج.
      </p>

      {widths.length > 1 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-fg">عرض الرول</p>
          <div className={cn('grid gap-2', widths.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
            {widths.map((option) => {
              const active = option.width_cm === current.width_cm
              return (
                <button
                  key={option.width_cm}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickWidth(option.width_cm)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-2 py-2.5 text-center transition-colors',
                    active ? 'border-brand bg-brand/5' : 'border-border hover:border-brand/50',
                  )}
                >
                  <span className="text-sm font-bold text-fg">
                    <Num>{String(option.width_cm)}</Num> سم
                  </span>
                  <span className="text-xs text-muted">
                    <Num>{formatPiastres(option.price_per_meter_piastres)}</Num> للمتر
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-muted">ده عرض الفيلم نفسه (الشريحة الواحدة). لو المكان أعرض منه، بنقسمه شرايح.</p>
        </div>
      ) : null}


      {mode === 'window' ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {widthLocked ? (
            <LockedCm id="window-width" label="عرض المكان" value={String(current.width_cm)} />
          ) : (
            <CmInput
              id="window-width"
              label="عرض المكان"
              placeholder="120"
              value={width}
              onChange={(next) => {
                setWidth(next)
                applyWindow(current, next, height)
              }}
            />
          )}
          <CmInput
            id="window-height"
            label="ارتفاع المكان"
            placeholder="150"
            value={height}
            onChange={(next) => {
              setHeight(next)
              applyWindow(current, windowWidthFor(current), next)
            }}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2">
            <StepButton onClick={() => stepBy(-1)} disabled={lengthCm <= current.min_length_cm} label="قلّل الطول">
              <Minus className="h-5 w-5" />
            </StepButton>

            <div className="text-center">
              <p className="text-xl font-extrabold text-fg">
                <Num>{formatLength(lengthCm)}</Num>
              </p>
              <p className="text-xs text-muted">
                (<Num>{String(lengthCm)}</Num> سم) · الخطوة <Num>{formatLength(current.step_cm)}</Num>
              </p>
            </div>

            <StepButton onClick={() => stepBy(1)} disabled={lengthCm >= current.max_length_cm} label="زوّد الطول">
              <Plus className="h-5 w-5" />
            </StepButton>
          </div>

          <p className="rounded-lg bg-bg px-3 py-2 text-xs leading-relaxed text-muted">
            الطول ده لشريط فيلم عرضه <Num>{String(current.width_cm)}</Num> سم. مش متأكد؟ ارجع للمقاس واكتبه
            بالسنتيمتر وإحنا نحسب.
          </p>

          {options.length > 0 ? (
            <div className="space-y-1.5">
              <label htmlFor="exact-length" className="block text-sm font-semibold text-fg">
                أو اختار الطول على طول
              </label>
              <select
                id="exact-length"
                value={String(lengthCm)}
                onChange={(event) => onLengthChange(Number(event.target.value))}
                className={inputClasses}
              >
                {options.map((option) => (
                  <option key={option} value={String(option)}>
                    {formatLength(option) + ' (' + String(option) + ' سم)'}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      )}

      {/* المكان أعرض من الرول = شرايح — بيتقال على طول عشان مايبانش تناقض */}
      {mode === 'window' && !widthLocked && !error && strips > 1 ? (
        <p className="mt-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-fg">
          المكان أعرض من الرول — هيتقسم <Num>{String(strips)}</Num> شرايح، كل واحدة <Num>{String(current.width_cm)}</Num> سم.
        </p>
      ) : null}

      {/* المقاس بالسم هو الطريق الأساسي — المتر لينك صغير للي عارف الطول */}
      <button
        type="button"
        onClick={() => switchMode(mode === 'window' ? 'length' : 'window')}
        className="mt-3 inline-flex items-center gap-1.5 rounded px-1 py-1 text-sm font-semibold text-brand hover:underline"
      >
        {mode === 'window' ? (
          <>
            <Ruler className="h-4 w-4" />
            عارف الطول اللي محتاجه بالمتر؟
          </>
        ) : (
          <>
            <Maximize className="h-4 w-4" />
            ارجع للمقاس بالسنتيمتر
          </>
        )}
      </button>

      {/* نتيجة الحساب */}
      <div className="mt-4">
        {error ? (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm font-medium text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : (
          <dl className="divide-y divide-border rounded-lg bg-bg px-3">
            <SummaryRow
              label="عرض الرول"
              value={
                <>
                  <Num>{String(current.width_cm)}</Num> سم
                </>
              }
            />
            {mode === 'window' && strips > 0 && !widthLocked ? (
              <SummaryRow label="عدد الشرايح" value={<Num>{String(strips)}</Num>} />
            ) : null}
            <SummaryRow
              label="الطول المطلوب"
              value={
                <>
                  <Num>{formatLength(lengthCm)}</Num>{' '}
                  <span className="text-xs font-medium text-muted">
                    (<Num>{String(lengthCm)}</Num> سم)
                  </span>
                </>
              }
            />
            <SummaryRow label="السعر" value={<Num>{formatPiastres(price)}</Num>} strong />
          </dl>
        )}
      </div>

      {mode === 'window' && !error && strips > 0 ? (
        <p className="mt-2 text-xs text-muted">
          <Num>{String(strips)}</Num> {strips === 1 ? 'شريحة' : 'شرايح'} × <Num>{height}</Num> سم ={' '}
          <Num>{String(neededCm)}</Num> سم
          {lengthCm > neededCm ? (
            <>
              {' ← بنقرّبها لـ '}
              <Num>{String(lengthCm)}</Num>
              {' سم'}
            </>
          ) : null}
        </p>
      ) : null}

      {mode === 'window' && !error && strips === 0 ? (
        <p className="mt-2 text-xs text-muted">
          {widthLocked
            ? 'اكتب الارتفاع بالسنتيمتر وإحنا نحسب الطول المطلوب.'
            : 'اكتب العرض والارتفاع بالسنتيمتر وإحنا نحسب عدد الشرايح والطول.'}
        </p>
      ) : null}
    </div>
  )
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: React.ReactNode
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cn('text-sm font-semibold text-fg', strong && 'text-base font-extrabold text-brand')}>
        {value}
      </dd>
    </div>
  )
}

function StepButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-12 w-12 items-center justify-center rounded border border-border text-fg transition-colors hover:border-muted disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function CmInput({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={5000}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClasses, 'pl-12')}
        />
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted">
          سم
        </span>
      </div>
    </div>
  )
}

/** خانة عرض مقفولة — العرض متثبّت من اللوحة للمنتج ده. */
function LockedCm({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value}
          readOnly
          aria-readonly="true"
          tabIndex={-1}
          className={cn(inputClasses, 'cursor-not-allowed bg-bg pl-14 text-muted')}
        />
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center gap-1 text-xs text-muted">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          سم
        </span>
      </div>
      <p className="text-xs text-muted">= عرض الرول اللي اخترته</p>
    </div>
  )
}
