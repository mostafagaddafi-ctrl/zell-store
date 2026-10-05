'use client'

import { useId } from 'react'
import { HardHat, Wrench } from 'lucide-react'
import { formatLength, formatPiastres, installationFeePiastres } from '@zell/core'
import type { InstallMode } from '../../lib/cart'
import { Num } from './Num'

const OPTIONS: Array<{ value: InstallMode; title: string; hint: string }> = [
  { value: 'self', title: 'هركّبه بنفسي', hint: 'تختار أدوات التركيب اللي محتاجها' },
  { value: 'installer', title: 'محتاج فني تركيب', hint: 'فني يركّبهولك — أجر بالمتر + انتقال' },
]

/**
 * «هتركّبه إزاي؟» — اختيار واحد من اتنين (radio) لأفلام المقاس، في صفحة المنتج والسلة.
 *
 * ⚠️ ده نية بس على مستوى السلة (cart.installMode). مش بيغيّر سعر أي صنف ولا الطلب.
 *    Checkout هو اللي بيقرر التوفر حسب المحافظة والمنطقة، والداتابيز بتحسب المعتمد.
 */
export function InstallChoice({
  mode,
  onChange,
  feePerMeterPiastres,
  lengthCm,
  governorates,
  context,
}: {
  mode: InstallMode
  onChange: (next: InstallMode) => void
  feePerMeterPiastres: number
  /** طول أفلام المقاس بالسنتيمتر — في صفحة المنتج الطول الحالي، وفي السلة مجموع الأفلام. */
  lengthCm: number
  /** المحافظات اللي فيها منطقة متاحة للفني (من إعداد اللوحة). */
  governorates: string[]
  context: 'product' | 'cart'
}) {
  const name = useId()
  const estimate = installationFeePiastres(feePerMeterPiastres, lengthCm)

  return (
    <fieldset className="rounded-lg border border-border bg-card p-4">
      <legend className="px-1 text-sm font-bold text-fg">هتركّبه إزاي؟</legend>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const selected = mode === option.value
          const Icon = option.value === 'installer' ? HardHat : Wrench
          return (
            <label
              key={option.value}
              className={
                'flex cursor-pointer items-start gap-2 rounded-lg border-2 p-3 text-sm transition-colors ' +
                (selected ? 'border-brand bg-brand/5' : 'border-border hover:border-brand/50')
              }
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold text-fg">
                  <Icon className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  {option.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{option.hint}</span>
              </span>
            </label>
          )
        })}
      </div>

      {mode === 'installer' ? (
        <div className="mt-3 space-y-1 rounded border border-dashed border-border p-3 text-xs text-muted">
          <p className="text-sm font-semibold text-fg">
            <Num>{formatPiastres(feePerMeterPiastres)}</Num> للمتر الطولي من أفلام المقاس
          </p>
          {estimate > 0 ? (
            <p>
              {context === 'product' ? 'تقدير التركيب للطول ده: ' : 'تقدير التركيب لأفلام السلة: '}
              <Num>{formatLength(lengthCm)}</Num> = <Num>{formatPiastres(estimate)}</Num>
            </p>
          ) : null}
          <p>
            انتقال الفني بيتحسب حسب منطقتك في صفحة الطلب. متاح حاليًا في: {governorates.join('، ')}.
          </p>
        </div>
      ) : null}
    </fieldset>
  )
}
