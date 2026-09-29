'use client'

import { useState } from 'react'
import { AlertTriangle, Maximize, Minus, Plus, Ruler } from 'lucide-react'
import { areRulesUsable, formatLength, lengthOptions, requiredLength, type StoreProduct } from '@zell/core'
import { cn } from '../../lib/cn'
import { inputClasses } from '../ui/Field'
import { Num } from './Num'

type Mode = 'window' | 'length'

/**
 * اختيار المقاس بطريقتين. الافتراضي «بمقاس الشباك» لأن ده اللي الزبون
 * عارفه فعلاً — الطول بالمتر حساب بنعمله إحنا مش هو.
 *
 * لو المقاس أكبر من الحد المتاح بنقول كده صراحة وبنمنع الإضافة للسلة،
 * بدل ما نقصّه بصمت زي النسخة القديمة.
 */
export function SizePicker({
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

  const rulesOk = areRulesUsable(product)
  const options = lengthOptions(product)

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
      // وإحنا بنكتب لسه: ما نزعّقش. بس المقاس الكبير لازم يتقال بوضوح.
      block(result.code === 'invalid_input' ? null : result.message)
      return
    }

    setStrips(result.strips)
    block(null)
    onLengthChange(result.lengthCm)
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    // الخروج من وضع الشباك بيلغي أي منع مرتبط بيه
    if (next === 'length') block(null)
    else applyWindow(width, height)
  }

  const stepBy = (delta: number) => {
    const next = lengthCm + delta * product.step_cm
    if (next < product.min_length_cm || next > product.max_length_cm) return
    onLengthChange(next)
  }

  if (!rulesOk) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-danger/40 bg-card p-3 text-sm text-danger">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        بيانات المنتج ده مش مكتملة دلوقتي. كلّمنا على واتساب ونساعدك.
      </p>
    )
  }

  const atMin = lengthCm <= product.min_length_cm
  const atMax = lengthCm >= product.max_length_cm

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => switchMode('window')}
          className={cn(
            'flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors',
            mode === 'window' ? 'bg-brand text-brand-fg' : 'text-muted',
          )}
        >
          <Maximize className="h-4 w-4" />
          بمقاس الشباك
        </button>
        <button
          type="button"
          onClick={() => switchMode('length')}
          className={cn(
            'flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors',
            mode === 'length' ? 'bg-brand text-brand-fg' : 'text-muted',
          )}
        >
          <Ruler className="h-4 w-4" />
          بالمتر
        </button>
      </div>

      {mode === 'window' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="window-width" className="block text-sm font-semibold text-fg">
                عرض الشباك
              </label>
              <div className="relative">
                <input
                  id="window-width"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={5000}
                  placeholder="120"
                  value={width}
                  onChange={(event) => {
                    setWidth(event.target.value)
                    applyWindow(event.target.value, height)
                  }}
                  className={cn(inputClasses, 'pl-12')}
                />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted">
                  سم
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="window-height" className="block text-sm font-semibold text-fg">
                ارتفاع الشباك
              </label>
              <div className="relative">
                <input
                  id="window-height"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={5000}
                  placeholder="150"
                  value={height}
                  onChange={(event) => {
                    setHeight(event.target.value)
                    applyWindow(width, event.target.value)
                  }}
                  className={cn(inputClasses, 'pl-12')}
                />
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted">
                  سم
                </span>
              </div>
            </div>
          </div>

          {error ? (
            <p className="flex items-start gap-2 rounded-xl border border-danger/40 bg-card p-3 text-sm font-medium text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          ) : strips > 0 ? (
            <p className="rounded-xl bg-card p-3 text-xs leading-relaxed text-muted">
              الرول عرضه <Num>{String(product.width_cm)}</Num> سم، فالشباك ده هياخد{' '}
              <span className="font-bold text-fg">
                <Num>{String(strips)}</Num> شريحة
              </span>{' '}
              — يعني طول مطلوب{' '}
              <span className="font-bold text-fg">
                <Num>{formatLength(lengthCm)}</Num>
              </span>
              .
            </p>
          ) : (
            <p className="text-xs text-muted">اكتب مقاس الشباك وإحنا نحسب الطول المطلوب.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-2">
            <button
              type="button"
              onClick={() => stepBy(-1)}
              disabled={atMin}
              aria-label="قلّل الطول"
              className="flex h-12 w-12 items-center justify-center rounded-lg border border-border text-fg disabled:opacity-40"
            >
              <Minus className="h-5 w-5" />
            </button>

            <div className="text-center">
              <p className="text-xl font-extrabold text-fg">
                <Num>{formatLength(lengthCm)}</Num>
              </p>
              <p className="text-xs text-muted">
                الخطوة <Num>{formatLength(product.step_cm)}</Num>
              </p>
            </div>

            <button
              type="button"
              onClick={() => stepBy(1)}
              disabled={atMax}
              aria-label="زوّد الطول"
              className="flex h-12 w-12 items-center justify-center rounded-lg border border-border text-fg disabled:opacity-40"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>

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
    </div>
  )
}
