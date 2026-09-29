import { useState } from 'react'
import { Minus, Plus, ShoppingCart } from 'lucide-react'
import {
  computeSubtotalPiastres,
  formatLength,
  formatPiastres,
  requiredLengthCm,
} from '../../lib/core/pricing'
import type { StoreProduct } from '../../lib/core/types'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'

type Mode = 'window' | 'meters'

/**
 * اختيار المقاس: بمقاس الشباك (الافتراضي) أو بالمتر.
 * بيتستخدم في الشيت السريع وفي صفحة المنتج بنفس المنطق.
 */
export function SizePicker({
  product,
  onConfirm,
  buttonLabel = 'ضيفه للسلة',
}: {
  product: StoreProduct
  onConfirm: (productId: number, lengthCm: number) => void
  buttonLabel?: string
}) {
  const [mode, setMode] = useState<Mode>('window')
  const [width, setWidth] = useState('120')
  const [height, setHeight] = useState('150')
  const [meters, setMeters] = useState(product.min_length_cm / 100)

  const w = Number(width) || 0
  const h = Number(height) || 0
  const windowValid = w > 0 && h > 0
  const lengthCm = mode === 'window' ? requiredLengthCm(w, h, product) : Math.round(meters * 100)
  const price = computeSubtotalPiastres(product.price_per_meter_piastres, lengthCm)
  const strips = windowValid ? Math.ceil(w / product.width_cm) : 1

  const stepMeters = (delta: number) => {
    const next = Math.round((meters + (delta * product.step_cm) / 100) * 10) / 10
    if (next < product.min_length_cm / 100 || next > product.max_length_cm / 100) return
    setMeters(next)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <ModeButton active={mode === 'window'} onClick={() => setMode('window')} text="بمقاس الشباك" />
        <ModeButton active={mode === 'meters'} onClick={() => setMode('meters')} text="بالمتر" />
      </div>

      {mode === 'window' ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">عرض الزجاج (سم)</span>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={width}
              onChange={(e) => setWidth(e.target.value.replace(/[^\d]/g, ''))}
              className="h-14 rounded-xl text-center text-xl font-bold"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">ارتفاع الزجاج (سم)</span>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value.replace(/[^\d]/g, ''))}
              className="h-14 rounded-xl text-center text-xl font-bold"
            />
          </label>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-4">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-14 w-14 rounded-full"
            aria-label="قلّل"
            onClick={() => stepMeters(-1)}
            disabled={meters <= product.min_length_cm / 100}
          >
            <Minus className="h-5 w-5" />
          </Button>
          <div className="min-w-28 text-center">
            <div className="text-3xl font-extrabold">{formatLength(Math.round(meters * 100))}</div>
            <div className="text-xs text-muted-foreground">أقل طلب {formatLength(product.min_length_cm)}</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-14 w-14 rounded-full"
            aria-label="زوّد"
            onClick={() => stepMeters(1)}
            disabled={meters >= product.max_length_cm / 100}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      )}

      <div className="rounded-xl bg-muted/60 p-4 text-center">
        {mode === 'window' && !windowValid ? (
          <p className="text-sm text-muted-foreground">اكتب المقاس عشان نحسبلك.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              هتحتاج <strong className="text-foreground">{formatLength(lengthCm)}</strong>
              {mode === 'window' && strips > 1 ? ` (${strips} شرايح جنب بعض)` : ''}
            </p>
            <p className="mt-1 text-3xl font-extrabold text-foreground">{formatPiastres(price)}</p>
            <p className="mt-1 text-xs text-muted-foreground">الشحن بيتحسب بعدين حسب محافظتك</p>
          </>
        )}
      </div>

      <Button
        onClick={() => onConfirm(product.id, lengthCm)}
        disabled={mode === 'window' && !windowValid}
        className="h-14 w-full rounded-xl text-base font-bold"
      >
        <ShoppingCart className="ml-2 h-5 w-5" />
        {buttonLabel}
      </Button>
    </div>
  )
}

function ModeButton({ active, onClick, text }: { active: boolean; onClick: () => void; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-12 rounded-xl border text-sm font-bold transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:text-foreground'
      }`}
    >
      {text}
    </button>
  )
}
