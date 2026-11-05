'use client'

import { useId } from 'react'
import { HardHat, Wrench } from 'lucide-react'
import { formatLength, formatPiastres, installationFeePiastres } from '@zell/core'
import type { ChosenInstallMode, InstallMode } from '../../lib/cart'
import { Num } from './Num'
import { installerOnlyLine } from '../../lib/install/installChoice'

const OPTIONS: Array<{ value: ChosenInstallMode; title: string; hint: string }> = [
  { value: 'self', title: 'هركّبه بنفسي', hint: 'تختار أدوات التركيب اللي محتاجها' },
  { value: 'installer', title: 'محتاج فني تركيب', hint: 'فني يركّبهولك — أجر بالمتر + انتقال' },
]

/**
 * «هتركّبه إزاي؟» — اختيار واحد من اتنين (radio حقيقي) لأفلام المقاس، في صفحة المنتج والسلة.
 *
 * الخياران بنفس الارتفاع (grid stretch + h-full)، والأيقونة والعنوان على سطر واحد والوصف تحتهم.
 * على الشاشات الضيقة جدًا بيبقوا صفين بدل ما النص يتزنق.
 *
 * ⚠️ ده نية بس على مستوى السلة (cart.installMode). مش بيغيّر سعر أي صنف ولا الطلب.
 *    Checkout هو اللي بيقرر التوفر حسب المحافظة والمنطقة، والداتابيز بتحسب المعتمد.
 *
 * «unset» (لسه ما اختارش): ولا radio متحدد، وسطر بيطلب الاختيار — مفيش اختيار افتراضي.
 */
export function InstallChoice({
  mode,
  onChange,
  feePerMeterPiastres,
  lengthCm,
  governorates,
  context,
  installerOnly = false,
}: {
  mode: InstallMode
  onChange: (next: ChosenInstallMode) => void
  feePerMeterPiastres: number
  /** طول أفلام المقاس بالسنتيمتر — في صفحة المنتج الطول الحالي، وفي السلة مجموع الأفلام. */
  lengthCm: number
  /** المحافظات اللي فيها منطقة متاحة للفني (من إعداد اللوحة). */
  governorates: string[]
  context: 'product' | 'cart'
  /** INSTALLER-ONLY — «فني فقط» من اللوحة: خيار الفني لوحده وسطر توضيح، ومن غير «بنفسي». */
  installerOnly?: boolean
}) {
  const name = useId()
  const hintId = useId()
  const unset = mode === 'unset'
  // INSTALLER-ONLY والاختيار الحالي مش فني (لسه، أو «بنفسي» من قبل) = لازم يختار الفني صراحة
  const needsPick = unset || (installerOnly && mode !== 'installer')
  const estimate = installationFeePiastres(feePerMeterPiastres, lengthCm)

  return (
    <fieldset className="rounded-lg border border-border bg-card p-4" {...(needsPick ? { 'aria-describedby': hintId } : {})}>
      <legend className="px-1 text-sm font-bold text-fg">هتركّبه إزاي؟</legend>
      {installerOnly ? <p className="px-1 text-xs font-semibold text-fg">{installerOnlyLine(context)}</p> : null}
      <div className={'mt-1 grid grid-cols-1 gap-2' + (installerOnly ? '' : ' min-[380px]:grid-cols-2')}>
        {(installerOnly ? OPTIONS.filter((option) => option.value === 'installer') : OPTIONS).map((option) => {
          const selected = mode === option.value
          const Icon = option.value === 'installer' ? HardHat : Wrench
          return (
            <label
              key={option.value}
              className={
                'flex h-full cursor-pointer items-start gap-2.5 rounded-lg border-2 p-3 text-sm transition-colors ' +
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40 ' +
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
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-1.5 font-semibold leading-5 text-fg">
                  {/* الخوذة شكلها نازل لتحت وأقرب للعنوان من المفتاح — رفعة ١px ومسافة صغيرة عشان يبانوا زي بعض */}
                  <Icon
                    className={'h-4 w-4 shrink-0 text-brand' + (option.value === 'installer' ? ' -translate-y-px me-0.5' : '')}
                    aria-hidden="true"
                  />
                  <span>{option.title}</span>
                </span>
                <span className="text-xs leading-5 text-muted">{option.hint}</span>
              </span>
            </label>
          )
        })}
      </div>

      {needsPick ? (
        <p id={hintId} className="mt-2 text-xs font-semibold text-fg">
          {installerOnly ? 'اختار «محتاج فني تركيب» عشان نكمل' : 'اختار هتركّبه إزاي عشان نكمل'}
        </p>
      ) : null}

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
