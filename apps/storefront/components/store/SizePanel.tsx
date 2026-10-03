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
  type StoreProduct,
} from '@zell/core'
import { cn } from '../../lib/cn'
import { inputClasses } from '../ui/Field'
import { Num } from './Num'

type Mode = 'window' | 'length'

/**
 * اختيار المقاس. الافتراضي «بمقاس الشباك» لأن ده اللي الزبون عارفه —
 * عدد الشرايح والطول حساب بنعمله إحنا.
 *
 * العرض المتثبّت (0013): خانة العرض بتظهر مقفولة على عرض الرول، والزبون
 * بيكتب الارتفاع بس — يعني شريحة واحدة. اختيار الطول بالمتر زي ما هو.
 *
 * 🔒 سلوك محفوظ: لو المقاس أكبر من الحد المتاح بنقول كده صراحة
 * وبنمنع الإضافة للسلة. ممنوع القص الصامت للحد الأقصى.
 */
export function SizePanel({
  product,
  lengthCm,
  onLengthChange,
  onBlockedChange,
}: {
  product: StoreProduct
  lengthCm: number
  onLengthChange: (next: number) => void
  onBlockedChange: (blocked: boolean) => void
}) {
  const [mode, setMode] = useState<Mode>('window')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [strips, setStrips] = useState(0)

  const options = lengthOptions(product)
  const price = computeSubtotalPiastres(product.price_per_meter_piastres, lengthCm)
  const widthLocked = product.lock_width === true
  const lockedWidth = String(product.width_cm)

  const block = (message: string | null) => {
    setError(message)
    onBlockedChange(message !== null)
  }

  const applyWindow = (nextWidth: string, nextHeight: string) => {
    if (nextWidth.trim() === '' || nextHeight.trim() === '') {
      setStrips(0)
      block(null)
      return
    }

    const result = requiredLength(Number(nextWidth), Number(nextHeight), product)

    if (!result.ok) {
      setStrips(0)
      // وإحنا بنكتب لسه ما نزعّقش — بس المقاس الكبير لازم يتقال بوضوح
      block(result.code === 'invalid_input' ? null : result.message)
      return
    }

    setStrips(result.strips)
    block(null)
    onLengthChange(result.lengthCm)
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    if (next === 'length') block(null)
    else applyWindow(widthLocked ? lockedWidth : width, height)
  }

  const stepBy = (delta: number) => {
    const next = lengthCm + delta * product.step_cm
    if (next < product.min_length_cm || next > product.max_length_cm) return
    onLengthChange(next)
  }

  if (!areRulesUsable(product)) {
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

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
        <ModeButton active={mode === 'window'} onClick={() => switchMode('window')}>
          <Maximize className="h-4 w-4" />
          بمقاس الشباك
        </ModeButton>
        <ModeButton active={mode === 'length'} onClick={() => switchMode('length')}>
          <Ruler className="h-4 w-4" />
          بالطول (متر)
        </ModeButton>
      </div>

      {mode === 'window' ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {widthLocked ? (
            <LockedCm id="window-width" label="عرض الشباك" value={lockedWidth} />
          ) : (
            <CmInput
              id="window-width"
              label="عرض الشباك"
              placeholder="120"
              value={width}
              onChange={(next) => {
                setWidth(next)
                applyWindow(next, height)
              }}
            />
          )}
          <CmInput
            id="window-height"
            label="ارتفاع الشباك"
            placeholder="150"
            value={height}
            onChange={(next) => {
              setHeight(next)
              applyWindow(widthLocked ? lockedWidth : width, next)
            }}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2">
            <StepButton onClick={() => stepBy(-1)} disabled={lengthCm <= product.min_length_cm} label="قلّل الطول">
              <Minus className="h-5 w-5" />
            </StepButton>

            <div className="text-center">
              <p className="text-xl font-extrabold text-fg">
                <Num>{formatLength(lengthCm)}</Num>
              </p>
              <p className="text-xs text-muted">
                الخطوة <Num>{formatLength(product.step_cm)}</Num>
              </p>
            </div>

            <StepButton onClick={() => stepBy(1)} disabled={lengthCm >= product.max_length_cm} label="زوّد الطول">
              <Plus className="h-5 w-5" />
            </StepButton>
          </div>

          {/* الطول لوحده كان بيلخبط: من رول عرضه كام؟ */}
          <p className="rounded-lg bg-bg px-3 py-2 text-xs leading-relaxed text-muted">
            الطول ده لشريط فيلم عرضه <Num>{String(product.width_cm)}</Num> سم. مش متأكد من الطول؟ اختار «بمقاس الشباك»
            واكتب المقاس بالسنتيمتر وإحنا نحسب.
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
                    {formatLength(option)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      )}

      {/* نتيجة الحساب */}
      <div className="mt-4">
        {error ? (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm font-medium text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : (
          <dl className="divide-y divide-border rounded-lg bg-bg px-3">
            {mode === 'window' && strips > 0 && !widthLocked ? (
              <SummaryRow label="عدد الشرايح" value={<Num>{String(strips)}</Num>} />
            ) : null}
            <SummaryRow
              label="عرض الرول"
              value={
                <>
                  <Num>{String(product.width_cm)}</Num> سم
                </>
              }
            />
            <SummaryRow label="الطول المطلوب" value={<Num>{formatLength(lengthCm)}</Num>} />
            <SummaryRow label="السعر" value={<Num>{formatPiastres(price)}</Num>} strong />
          </dl>
        )}
      </div>

      {mode === 'window' && !error && strips === 0 ? (
        <p className="mt-2 text-xs text-muted">
          {widthLocked
            ? 'اكتب ارتفاع الشباك وإحنا نحسب الطول المطلوب.'
            : 'اكتب مقاس الشباك وإحنا نحسب عدد الشرايح والطول المطلوب.'}
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

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-11 items-center justify-center gap-2 rounded text-sm font-semibold transition-colors',
        active ? 'bg-card text-fg shadow-card' : 'text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
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
      <p className="text-xs text-muted">العرض ثابت للمنتج ده</p>
    </div>
  )
}
