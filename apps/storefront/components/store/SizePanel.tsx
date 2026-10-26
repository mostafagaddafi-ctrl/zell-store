'use client'

import { useEffect, useId, useLayoutEffect, useState } from 'react'
import { AlertTriangle, Lock, Maximize, Minus, Plus, Ruler } from 'lucide-react'
import {
  areRulesUsable,
  computeSubtotalPiastres,
  formatLength,
  formatPiastres,
  lengthOptions,
  widthOptionsOf,
  withWidth,
  type ProductSizeEntry,
  type ProductSizeTexts,
  type StoreProduct,
} from '@zell/core'
import { cn } from '../../lib/cn'
import { clearSizeDraft, readSizeDraft, saveSizeDraft } from '../../lib/drafts'
import {
  cmEntryState,
  cmErrorVisible,
  entryBlocksOrder,
  entryDisablesOrder,
  isUntouchedSize,
  meterLengthOf,
  modeOfEntry,
  restoreSizeDraft,
  sizeDecision,
  sizeDraftOf,
  sizeRulesKeyOf,
  switchToMetersParts,
  type SizeDecision,
  type SizeMode,
} from '../../lib/size/sizeEntry'
import { resolveSizeTexts } from '../../lib/size/sizeTexts'
import { inputClasses } from '../ui/Field'
import { Num } from './Num'

/**
 * اختيار المقاس — كارت واحد بالترتيب: عرض الرول ← المقاس ← النتيجة.
 *
 * القاعدة: «بتقيس بالسنتيمتر، وبتدفع بالمتر». أي حاجة بيكتبها الزبون
 * بالسم (المازورة)، والطول والسعر بالمتر وجنبه السم بين قوسين.
 *
 * العروض (0015): أزرار جوه نفس الكارت لو المنتج ليه أكتر من عرض. تغيير
 * العرض **بيحتفظ** بمقاس الشباك المكتوب وبيعيد الحساب على العرض الجديد
 * على طول.
 *
 * العرض المتثبّت (0013): خانة عرض الشباك مقفولة على العرض المختار.
 *
 * 🔒 سلوك محفوظ: لو المقاس أكبر من الحد المتاح بنقول كده صراحة
 * وبنمنع الإضافة للسلة. ممنوع القص الصامت للحد الأقصى.
 *
 * LENGTH-INPUT (docs/contracts/LENGTH-INPUT.md — المنطق في lib/size/sizeEntry.ts):
 *   • الطريقة الأولى من إعداد «المحتوى» (sizeEntry)، والمسودة ببصمة القواعد الحالية ليها الأولوية. الإعداد بيحدد البداية بس.
 *   • طريقة السنتيمتر الفاضية أو الغلط أو تحت الحد (الشرايح × الارتفاع < الحد الأدنى) = الطلب ممنوع (قرار الطلب من لقطة واحدة وقت الضغط: decisionRef ← sizeDecision)
 *     من غير ما الزرار يتقفل، ومفيش رفع صامت للحد الأدنى ولا طول قديم. الكتابة حرة؛ الأحمر والرسالة والهزة بعد الخروج من
 *     الخانة أو محاولة الطلب (attempt)، ومع reduced motion مفيش هزة. الرقم المكتوب بيفضل زي ما هو.
 *   • التحويل للمتر بضغطة العميل بس، والطول = آخر طول صالح بالمتر أو الحد الأدنى.
 *
 * SIZE-TEXTS (lib/size/sizeTexts.ts): النصوص من «المحتوى» (الغايب أو الفاضي = النص الافتراضي)، وبتتعرض كنص عادي.
 *   مالهاش دخل بالحساب ولا بصمة المسودة (sizeRulesKeyOf). رسايل الأخطاء والأرقام والوحدات ثابتة.
 */
export function SizePanel({
  product,
  widthCm,
  onWidthChange,
  lengthCm,
  onLengthChange,
  onBlockedChange,
  sizeEntry = 'cm',
  decisionRef,
  attempt = 0,
  sizeTexts,
}: {
  /** المنتج الأساسي — العروض التانية بتتحسب منه. */
  product: StoreProduct
  /** العرض المختار. */
  widthCm: number
  onWidthChange: (next: number) => void
  lengthCm: number
  onLengthChange: (next: number) => void
  /** قفل الزرار (المقاس أكبر من الحد المتاح) — زي النهارده. */
  onBlockedChange: (blocked: boolean) => void
  /** LENGTH-INPUT — الطريقة الأولى من إعداد «المحتوى» (الغايب = سنتيمتر). */
  sizeEntry?: ProductSizeEntry
  /**
   * LENGTH-INPUT — دالة قرار الطلب من لقطة المقاس الحالية (الطريقة + الخانات + العرض + طول المتر). بتتحدّث بعد كل commit
   * (useLayoutEffect) قبل أي ضغطة، و«ضيف للسلة» و«اطلب دلوقتي» بيناديها وقت الضغط — مفيش اعتماد على مزامنة بالـ effects.
   */
  decisionRef?: { current: (() => SizeDecision) | null }
  /** LENGTH-INPUT — بيزيد مع كل ضغطة على زرار الطلب والإدخال ممنوع: بيظهر الخطأ والهزة. */
  attempt?: number
  /** SIZE-TEXTS — نصوص «حدد المقاس» من «المحتوى» (الغايب أو الفاضي = النص الافتراضي). نصوص عرض بس. */
  sizeTexts?: ProductSizeTexts
}) {
  const t = resolveSizeTexts(sizeTexts)
  const initialMode = modeOfEntry(sizeEntry)
  const [mode, setMode] = useState<SizeMode>(initialMode)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [touched, setTouched] = useState(false)
  const [shaking, setShaking] = useState(false)
  /** آخر طول صالح اختاره العميل بالمتر (أو من المسودة) — null = الحد الأدنى. */
  const [meterCm, setMeterCm] = useState<number | null>(null)
  const errorId = useId()

  const widths = widthOptionsOf(product)
  const current = withWidth(product, widthCm) ?? product
  const options = lengthOptions(current)
  const price = computeSubtotalPiastres(current.price_per_meter_piastres, lengthCm)
  const widthLocked = product.lock_width === true

  const windowWidthFor = (rules: StoreProduct) => (widthLocked ? String(rules.width_cm) : width)
  const cmState = cmEntryState(windowWidthFor(current), height, current)
  const exceeds = entryDisablesOrder(mode, cmState)
  const orderBlocked = entryBlocksOrder(mode, cmState)
  const showCmError = mode === 'window' && cmErrorVisible(cmState, touched)
  const okLength = mode === 'window' && cmState.kind === 'ok' ? cmState.lengthCm : null

  // الحالة بتتحسب مع كل تغيير (الخانات · العرض · الطريقة · المسودة)، والأب بيعرف بيها على طول.
  useEffect(() => {
    onBlockedChange(exceeds)
  }, [exceeds])
  // لقطة القرار من نفس الـ render اللي اتعمل له commit (الخانات والعرض والطريقة وطول المتر)
  useLayoutEffect(() => {
    if (!decisionRef) return
    decisionRef.current = () =>
      sizeDecision({ mode, widthText: windowWidthFor(current), heightText: height, rules: current, meterLengthCm: lengthCm })
  })
  useEffect(() => {
    if (okLength !== null && okLength !== lengthCm) onLengthChange(okLength)
  }, [okLength])

  const shake = () => {
    setShaking(false)
    window.requestAnimationFrame(() => setShaking(true))
  }

  /** الخروج من خانة سنتيمتر: الخطأ يبان (لو فيه) مع هزة خفيفة مرة واحدة. */
  const reveal = () => {
    setTouched(true)
    if (orderBlocked) shake()
  }

  // ضغطة على «ضيف للسلة» أو «اطلب دلوقتي» والإدخال ممنوع
  useEffect(() => {
    if (attempt === 0 || mode !== 'window') return
    setTouched(true)
    shake()
  }, [attempt])

  const pickWidth = (next: number) => {
    const rules = withWidth(product, next)
    if (!rules) return
    onWidthChange(next)
  }

  const switchMode = (next: SizeMode) => {
    setMode(next)
    if (next === 'length') onLengthChange(meterLengthOf(meterCm, current))
  }

  const setMeter = (next: number) => {
    setMeterCm(next)
    onLengthChange(next)
  }

  const stepBy = (delta: number) => {
    const next = lengthCm + delta * current.step_cm
    if (next < current.min_length_cm || next > current.max_length_cm) return
    setMeter(next)
  }

  /**
   * مسودة المقاس (sessionStorage، للمنتج ده في التاب ده): لو العميل راح للسلة ورجع يلاقي اللي كتبه.
   * بترجع بس لو بصمة القواعد زي ما هي. مسودة السنتيمتر بترجع بخاناتها زي ما هي (حتى لو ناقصة أو تحت الحد) والطلب
   * ممنوع لحد التصحيح؛ آخر اختيار بالمتر (meterCm) محفوظ لوحده وبيرجع بس لو صالح، وطول السنتيمتر مابيبقاش اختيار متر. القراءة بعد التركيب (السيرفر مالوش sessionStorage)، والحفظ بعدها بس.
   */
  const rulesKey = sizeRulesKeyOf(product)
  const [draftLoaded, setDraftLoaded] = useState(false)
  useEffect(() => {
    const restored = restoreSizeDraft(readSizeDraft(product.id), rulesKey, product)
    if (restored !== null) {
      onWidthChange(restored.widthCm)
      setMode(restored.mode)
      setWidth(restored.windowWidth)
      setHeight(restored.windowHeight)
      setMeterCm(restored.meterLengthCm)
      if (restored.mode === 'length') {
        onLengthChange(meterLengthOf(restored.meterLengthCm, withWidth(product, restored.widthCm) ?? product))
      }
    }
    setDraftLoaded(true)
  }, [])

  useEffect(() => {
    if (!draftLoaded) return
    const untouched = isUntouchedSize({
      mode,
      initialMode,
      width,
      height,
      widthCm,
      productWidthCm: product.width_cm,
      lengthCm,
      minLengthCm: product.min_length_cm,
      meterCm,
    })
    if (untouched) {
      clearSizeDraft(product.id)
      return
    }
    // اختيار المتر (meterCm) بيتحفظ لوحده، منفصل عن ناتج السنتيمتر
    saveSizeDraft(product.id, sizeDraftOf({ rulesKey, widthCm, mode, width, height, lengthCm, meterCm }))
  }, [draftLoaded, mode, width, height, widthCm, lengthCm, rulesKey, product.id, product.width_cm, product.min_length_cm, initialMode, meterCm])

  if (!areRulesUsable(current)) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-card p-4 text-sm text-danger">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        بيانات المنتج ده مش مكتملة دلوقتي. كلّمنا على واتساب ونساعدك.
      </p>
    )
  }

  const switchParts = switchToMetersParts(current.min_length_cm)
  const cmMessage = cmState.kind !== 'ok' ? cmState.message : ''

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 className="text-base font-bold text-fg">{t.title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {t.intro}
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
          <p className="mt-1.5 text-xs text-muted">{t.rollHint}</p>
        </div>
      ) : null}

      {mode === 'window' ? (
        <div
          className={cn('mt-4 grid grid-cols-2 gap-3', shaking && 'motion-safe:animate-size-shake')}
          onAnimationEnd={() => setShaking(false)}
        >
          {/* متثبّت: خانة مقفولة على الرول المختار — بتبيّن للزبون إن ده أقصى عرض */}
          {widthLocked ? (
            <LockedCm
              id="window-width"
              label={t.widthLabel}
              value={String(current.width_cm)}
              hint={widths.length > 1 ? 'ثابت على عرض الرول اللي اخترته' : 'العرض ثابت للمنتج ده'}
            />
          ) : (
            <CmInput
              id="window-width"
              label={t.widthLabel}
              placeholder="120"
              value={width}
              invalid={showCmError}
              describedBy={showCmError ? errorId : undefined}
              onBlur={reveal}
              onChange={setWidth}
            />
          )}
          <CmInput
            id="window-height"
            label={t.heightLabel}
            placeholder="500"
            hint={t.heightExample}
            value={height}
            invalid={showCmError}
            describedBy={showCmError ? errorId : undefined}
            onBlur={reveal}
            onChange={setHeight}
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
            الطول ده لشريط فيلم عرضه <Num>{String(current.width_cm)}</Num> سم. {t.meterNote}
          </p>

          {options.length > 0 ? (
            <div className="space-y-1.5">
              <label htmlFor="exact-length" className="block text-sm font-semibold text-fg">
                أو اختار الطول على طول
              </label>
              <select
                id="exact-length"
                value={String(lengthCm)}
                onChange={(event) => setMeter(Number(event.target.value))}
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
      {mode === 'window' && !widthLocked && cmState.kind === 'ok' && cmState.strips > 1 ? (
        <p className="mt-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-fg">
          المكان أعرض من الرول — هيتقسم <Num>{String(cmState.strips)}</Num> شرايح، كل واحدة <Num>{String(current.width_cm)}</Num> سم.
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
            {t.toMeters}
          </>
        ) : (
          <>
            <Maximize className="h-4 w-4" />
            {t.toCentimeters}
          </>
        )}
      </button>

      {/* نتيجة الحساب */}
      <div className="mt-4">
        {exceeds ? (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm font-medium text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {cmMessage}
          </p>
        ) : showCmError ? (
          <div
            id={errorId}
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm font-medium text-danger"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p>{cmMessage}</p>
              {cmState.kind === 'below_min' ? (
                <p className="text-xs font-normal leading-relaxed text-fg">
                  {switchParts.before}
                  <button
                    type="button"
                    onClick={() => switchMode('length')}
                    className="font-semibold text-brand underline underline-offset-2"
                  >
                    {switchParts.link}
                  </button>
                  {switchParts.after}
                </p>
              ) : null}
            </div>
          </div>
        ) : mode === 'length' || cmState.kind === 'ok' ? (
          <dl className="divide-y divide-border rounded-lg bg-bg px-3">
            <SummaryRow
              label="عرض الرول"
              value={
                <>
                  <Num>{String(current.width_cm)}</Num> سم
                </>
              }
            />
            {mode === 'window' && cmState.kind === 'ok' && !widthLocked ? (
              <SummaryRow label="عدد الشرايح" value={<Num>{String(cmState.strips)}</Num>} />
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
        ) : null}
      </div>

      {mode === 'window' && cmState.kind === 'ok' ? (
        <p className="mt-2 text-xs text-muted">
          <Num>{String(cmState.strips)}</Num> {cmState.strips === 1 ? 'شريحة' : 'شرايح'} × <Num>{height}</Num> سم ={' '}
          <Num>{String(cmState.neededCm)}</Num> سم
          {cmState.lengthCm > cmState.neededCm ? (
            <>
              {' ← بنقرّبها لـ '}
              <Num>{String(cmState.lengthCm)}</Num>
              {' سم'}
            </>
          ) : null}
        </p>
      ) : null}

      {mode === 'window' && cmState.kind !== 'ok' && !exceeds && !showCmError ? (
        <p className="mt-2 text-xs text-muted">
          {widthLocked
            ? 'اكتب الارتفاع بالسنتيمتر وإحنا نحسب الطول المطلوب.'
            : t.guide}
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
  onBlur,
  invalid = false,
  describedBy,
  hint,
}: {
  id: string
  label: string
  placeholder: string
  /** سطر مثال تحت الخانة — عرض بس. */
  hint?: string
  value: string
  onChange: (next: string) => void
  onBlur?: () => void
  /** LENGTH-INPUT — الخطأ ظاهر: الرقم والإطار أحمر، والرقم المكتوب زي ما هو. */
  invalid?: boolean
  describedBy?: string | undefined
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
          onBlur={onBlur}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputClasses, 'pl-12', invalid && 'border-danger text-danger focus:border-danger focus:ring-danger/30')}
        />
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted">
          سم
        </span>
      </div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

/** خانة عرض مقفولة — العرض متثبّت على عرض الرول (المختار لو فيه أكتر من عرض). */
function LockedCm({ id, label, value, hint }: { id: string; label: string; value: string; hint: string }) {
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
      <p className="text-xs text-muted">{hint}</p>
    </div>
  )
}
