'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Wrench } from 'lucide-react'
import {
  cartToolFilmIds,
  computeShippingPiastres,
  describeLine,
  formatPiastres,
  hasErrors,
  installationAreasIn,
  installationFeePiastres,
  installationLengthCm,
  installationReadyGovernorates,
  installationToolsHref,
  installationTravelPiastres,
  lineTotalPiastres,
  resolveCartLine,
  validateCheckout,
  type CheckoutValues,
  type StoreProduct,
  type StoreSettings,
} from '@zell/core'
import { canonicalOrderJson, normalizeOrder } from '../../lib/orders/canonical'
import { useCart } from '../../lib/cart'
import { Button, buttonClasses } from '../ui/Button'
import { Field, inputClasses, textareaClasses } from '../ui/Field'
import { Num } from './Num'
import { OrderSummary } from './OrderSummary'

/**
 * مفتاح النية — ORDER-FLOW-PLAN.md §4.1.
 *
 * ⚠️ المفتاح ده **مش سر**: مقروء من JavaScript بحكم مكانه، ولوحده مع الـbody
 *    ما يقدرش يصدر ولا يدوّر أي وصول للإيصال — ده دور كوكي الجلسة (ب١٠).
 *
 * بيتثبت لما النية تبقى نفسها (إعادة محاولة = replay على نفس الطلب)،
 * وبيتجدد لما البيانات تتغير فعلاً (نية جديدة = طلب جديد).
 *
 * ⚠️ الربط على **الصيغة القانونية** اللي السيرفر بيهشها، مش على الـbody الخام:
 *    تعديل شكلي (مسافة في الاسم، أو ترتيب أصناف مختلف) ما بيغيّرش النية، فلازم
 *    يفضل نفس المفتاح. لو اتربط بالـbody الخام، أول إرسال نجح وضاع رده +
 *    تعديل شكلي = **طلب تاني** بدل replay.
 */
const INTENT_KEY = 'zell-order-intent'

/**
 * خريطة محدودة: آخر ٥ نوايا بس.
 *
 * خانة واحدة ما كانتش كفاية: لو الزبون عدّل البيانات ثم رجّعها لأصلها، النية
 * الأصلية كانت بتفقد مفتاحها وتاخد واحد جديد — فلو أول إرسال نجح وضاع رده،
 * الإرسال التاني كان بيعمل طلب تاني بدل replay.
 *
 * 🔒 المخزّن هنا `canonical` و`key` **وبس**. ممنوع أي رمز إيصال أو أي سر —
 *    رمز الإيصال عمره ما يلمس JavaScript أصلاً (HttpOnly).
 */
const INTENT_LIMIT = 5

type IntentEntry = { canonical: string; key: string }

function newIntentKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'k-' + String(Date.now()) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

function readIntents(): IntentEntry[] {
  try {
    const raw = window.sessionStorage.getItem(INTENT_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const entries: IntentEntry[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const candidate = entry as { canonical?: unknown; key?: unknown }
      if (typeof candidate.canonical !== 'string') continue
      if (typeof candidate.key !== 'string' || candidate.key.length < 16) continue
      entries.push({ canonical: candidate.canonical, key: candidate.key })
    }
    return entries
  } catch {
    return []
  }
}

function writeIntents(entries: IntentEntry[]): void {
  try {
    // الأقدم بيتشال من الأول — آخر INTENT_LIMIT بس
    window.sessionStorage.setItem(INTENT_KEY, JSON.stringify(entries.slice(-INTENT_LIMIT)))
  } catch {
    // التخزين مقفول — المفتاح يفضل صالح للمحاولة الحالية
  }
}

function resolveIdempotencyKey(canonical: string): string {
  const entries = readIntents()
  const existing = entries.find((entry) => entry.canonical === canonical)
  if (existing !== undefined) return existing.key

  const key = newIntentKey()
  writeIntents([...entries, { canonical, key }])
  return key
}

/** بيشيل نية واحدة بس — باقي النوايا في التاب ده تفضل زي ما هي. */
function forgetIntent(canonical: string): void {
  const entries = readIntents().filter((entry) => entry.canonical !== canonical)
  writeIntents(entries)
}

function isOrderSuccess(value: unknown): value is { ok: true; order: { orderNumber: string } } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { ok?: unknown; order?: { orderNumber?: unknown } }
  return candidate.ok === true && typeof candidate.order?.orderNumber === 'string'
}

function isOrderFailure(value: unknown): value is { ok: false; code: string; message: string } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { ok?: unknown; code?: unknown; message?: unknown }
  return candidate.ok === false && typeof candidate.code === 'string' && typeof candidate.message === 'string'
}

const EMPTY: CheckoutValues = {
  customerName: '',
  customerPhone: '',
  governorate: '',
  address: '',
  notes: '',
}

export function CheckoutForm({ products, settings }: { products: StoreProduct[]; settings: StoreSettings }) {
  const cart = useCart()
  const [values, setValues] = useState<CheckoutValues>(EMPTY)
  // 0018 — فني التركيب بالسعر: أجر لكل متر من أفلام المقاس + انتقال حسب المنطقة،
  // والاتنين داخلين في الإجمالي. الحساب هنا للعرض؛ المعتمد من zell_create_order.
  // PR4 — نية الفني جاية من صفحة المنتج/السلة (cart.installMode)، وهنا الحكم النهائي حسب المحافظة والمنطقة.
  // تغييرها هنا بيرجع للسلة، فالاختيار واحد في كل الصفحات.
  const installation = cart.installMode === 'installer'
  const setInstallation = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(installation) : next
    cart.setInstallMode(value ? 'installer' : 'self')
  }
  // المنطقة: معامل صريح في الطلب (area) — مابقتش بتتلزق في العنوان.
  const [area, setArea] = useState('')
  const areas = values.governorate !== '' ? (settings.shippingAreas[values.governorate] ?? []) : []
  const selectedArea = areas.includes(area) ? area : ''
  const installerAreas = values.governorate !== '' ? installationAreasIn(settings.installation, values.governorate) : []
  // بترتيب قايمة الشحن، والمتاح للفني بس
  const installerChoices = areas.filter((name) => installerAreas.includes(name))
  const [touched, setTouched] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // «هركّبه بنفسي» من غير صفحة أدوات متاحة → نفضل هنا برسالة واضحة
  const [selfNotice, setSelfNotice] = useState(false)
  const router = useRouter()
  const abortRef = useRef<AbortController | null>(null)

  const byId = useMemo(() => {
    const map = new Map<number, StoreProduct>()
    for (const product of products) map.set(product.id, product)
    return map
  }, [products])

  const entries = cart.lines
    .map((line) => {
      const base = byId.get(line.productId)
      return { line, product: base ? (resolveCartLine(base, line) ?? undefined) : undefined }
    })
    .filter((entry): entry is { line: (typeof cart.lines)[number]; product: StoreProduct } => Boolean(entry.product))

  const subtotal = entries.reduce(
    (sum, entry) => sum + lineTotalPiastres(entry.product, entry.line),
    0,
  )

  const shipping = values.governorate
    ? computeShippingPiastres(
        values.governorate,
        subtotal,
        settings.shippingRates,
        settings.shippingDefaultPiastres,
        settings.freeShippingThresholdPiastres,
      )
    : null

  // 0018 — الفني لأفلام المقاس بس، والشحن المجاني بيتحسب على الأصناف بس (فوق).
  const meterLengthCm = installationLengthCm(entries)
  const installationOffered = installerChoices.length > 0 && meterLengthCm > 0
  const installationChosen = installation && installationOffered
  const travel =
    installationChosen && selectedArea !== ''
      ? installationTravelPiastres(settings.installation, values.governorate, selectedArea)
      : null
  const installationReady = installationChosen && travel !== null
  const installationFee =
    installationReady && settings.installation.feePerMeterPiastres !== null
      ? installationFeePiastres(settings.installation.feePerMeterPiastres, meterLengthCm)
      : null
  // مختار فني والمنطقة ناقصة أو مش متاحة → الإرسال مقفول لحد ما يختار متاحة أو «هركّبه بنفسي»
  const installationBlocked = installationChosen && !installationReady
  // PR4 — نية فني والمحافظة مالهاش فني: الطلب مايكملش من غير ما العميل يختار «هركّبه بنفسي»
  const installerGovernorates = installationReadyGovernorates(settings.installation)
  const intentStranded = installation && values.governorate !== '' && meterLengthCm > 0 && installerChoices.length === 0
  const submitBlocked = installationBlocked || intentStranded

  // «هركّبه بنفسي وشوف أدوات التركيب»: الاختيار يرجع «بنفسي» (بيتحفظ في السلة)، والعميل يروح لأدوات
  // أفلام سلته بنفس معيار زرار السلة. مفيش صفحة أدوات أو مفيش أدوات → يفضل هنا برسالة، من غير رابط ميت.
  // ⚠️ ده الطريق الوحيد اللي بيغيّر النية هنا — الرجوع العادي مابيفترضش حاجة.
  const selfToolsHref = settings.installationToolsPage.enabled
    ? installationToolsHref(
        cartToolFilmIds(
          entries.map((entry) => entry.line),
          byId,
        ),
      )
    : null
  const selfLabel = selfToolsHref !== null ? 'هركّبه بنفسي وشوف أدوات التركيب' : 'هركّبه بنفسي وكمّل من غير فني'
  function chooseSelf() {
    setInstallation(false)
    if (selfToolsHref !== null) {
      router.push(selfToolsHref)
      return
    }
    setSelfNotice(true)
  }

  const errors = validateCheckout(values, settings.governorates)
  const invalid = hasErrors(errors)

  const set = (patch: Partial<CheckoutValues>) => setValues({ ...values, ...patch })
  const show = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

  // 0015 — العرض بيتبعت بس لو مختار غير الأساسي؛ السعر الداتابيز هي اللي بتحسبه
  // 0016 — القطعة بتتبعت بعددها بس (من غير طول/عرض)
  const items = entries.map((entry) =>
    entry.line.quantity !== undefined
      ? { productId: entry.product.id, quantity: entry.line.quantity }
      : entry.line.widthCm === undefined
        ? { productId: entry.product.id, lengthCm: entry.line.lengthCm }
        : { productId: entry.product.id, lengthCm: entry.line.lengthCm, widthCm: entry.line.widthCm },
  )

  async function submit(): Promise<void> {
    setTouched(true)
    setFailure(null)
    if (invalid || submitting || items.length === 0 || submitBlocked) return

    // 0018 — العنوان زي ما الزبون كتبه، والمنطقة والفني حقول لوحدهم (داخلين في الهاش).
    // الملاحظات من غير أي علامة — العلامة القديمة للأوردرات القديمة بس.
    const payload = {
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      governorate: values.governorate,
      address: values.address,
      notes: values.notes.trim() === '' ? null : values.notes,
      items,
      ...(selectedArea !== '' ? { area: selectedArea } : {}),
      ...(installationReady ? { installation: true as const } : {}),
    }
    const body = JSON.stringify(payload)

    // نفس منطق السيرفر بالحرف — من ./lib/orders/canonical
    const canonical = canonicalOrderJson(normalizeOrder(payload))
    const idempotencyKey = resolveIdempotencyKey(canonical)

    // طلب واحد في اللحظة من التاب ده — تقليل احتمال التسابق (§4.4)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSubmitting(true)

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body,
        // لازم تتبعت الكوكيز: zell_ck إثبات المتصفح، ومن غيرها كل submit بيترفض
        credentials: 'same-origin',
        signal: controller.signal,
      })

      const result: unknown = await response.json().catch(() => null)

      if (response.ok && isOrderSuccess(result)) {
        // السلة تتنضّف **بعد** الرد الناجح بس
        forgetIntent(canonical)
        cart.clear()
        router.push('/order/' + result.order.orderNumber)
        return
      }

      if (isOrderFailure(result)) {
        // البيانات اتغيّرت على نفس المفتاح — النية الجاية تاخد مفتاح جديد
        if (result.code === 'IDEMPOTENCY_MISMATCH') forgetIntent(canonical)
        setFailure(result.message)
      } else {
        setFailure('حصلت مشكلة غير متوقّعة. كلّمنا على واتساب.')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setFailure('الشبكة وقعت. جرّب تاني — الطلب مش بيتكرر.')
    }

    setSubmitting(false)
  }

  if (cart.ready && entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
        <p className="text-sm text-muted">السلة فاضية.</p>
        <Link href="/" className={buttonClasses('primary', 'md', 'mt-5 inline-flex')}>
          شوف الأنواع
        </Link>
      </div>
    )
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-12 lg:gap-10"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-6 lg:col-span-7">
        <div className="space-y-5 rounded-lg border border-border bg-card p-4 sm:p-6">
          <Field htmlFor="name" label="الاسم بالكامل" error={show('customerName')}>
            <input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="مثال: أحمد محمود"
              value={values.customerName}
              onChange={(event) => set({ customerName: event.target.value })}
              className={inputClasses}
            />
          </Field>

          <Field htmlFor="phone" label="رقم الموبايل" error={show('customerPhone')} hint="هنكلمك عليه لتأكيد الطلب">
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              dir="ltr"
              placeholder="01xxxxxxxxx"
              value={values.customerPhone}
              onChange={(event) => set({ customerPhone: event.target.value })}
              className={inputClasses + ' text-right'}
            />
          </Field>

          <Field htmlFor="governorate" label="المحافظة" error={show('governorate')}>
            <select
              id="governorate"
              name="governorate"
              autoComplete="address-level1"
              value={values.governorate}
              onChange={(event) => {
                set({ governorate: event.target.value })
                setArea('')
              }}
              className={inputClasses}
            >
              <option value="">اختار المحافظة</option>
              {settings.governorates.map((governorate) => (
                <option key={governorate} value={governorate}>
                  {governorate}
                </option>
              ))}
            </select>
          </Field>

          {areas.length > 0 ? (
            <Field
              htmlFor="area"
              label="المنطقة"
              error={installationChosen && touched && selectedArea === '' ? 'المنطقة مطلوبة لفني التركيب' : undefined}
            >
              <select
                id="area"
                name="area"
                autoComplete="address-level2"
                value={selectedArea}
                onChange={(event) => setArea(event.target.value)}
                className={inputClasses}
              >
                <option value="">اختار المنطقة (أو اكتبها في العنوان)</option>
                {areas.map((name) => (
                  <option key={name} value={name}>
                    {name + (installationChosen && installerAreas.includes(name) ? ' — فني متاح' : '')}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {intentStranded ? (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-fg">
              <p className="font-semibold">فني التركيب مش متاح في {values.governorate} حاليًا.</p>
              {installerGovernorates.length > 0 ? (
                <p className="mt-1 text-muted">متاح في: {installerGovernorates.join('، ')}</p>
              ) : null}
              <p className="mt-1 text-muted">ممكن تكمل الطلب من غير فني وتختار أدوات التركيب المناسبة.</p>
              <button type="button" onClick={chooseSelf} className={buttonClasses('secondary', 'md', 'mt-2 w-full')}>
                {selfLabel}
              </button>
            </div>
          ) : null}

          {selfNotice && !installation ? (
            <div role="status" className="rounded-lg border border-border bg-card p-3 text-xs text-fg">
              <p className="font-semibold">تمام — الطلب هيكمل من غير فني تركيب.</p>
              <p className="mt-1 text-muted">كمّل بيانات التوصيل وأكّد الطلب.</p>
            </div>
          ) : null}

          {installationOffered ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setInstallation((current) => !current)}
                aria-pressed={installationChosen}
                className={
                  'flex w-full items-center gap-3 rounded-lg border-2 p-4 text-right transition-colors ' +
                  (installationChosen ? 'border-brand bg-brand text-brand-fg shadow-card' : 'border-brand/40 bg-card hover:border-brand')
                }
              >
                <span
                  className={
                    'grid h-10 w-10 shrink-0 place-items-center rounded-full ' +
                    (installationChosen ? 'bg-brand-fg/15 text-brand-fg' : 'bg-brand/10 text-brand')
                  }
                >
                  {installationChosen ? <CheckCircle2 className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={'block text-base font-bold ' + (installationChosen ? 'text-brand-fg' : 'text-fg')}>
                    {installationChosen ? 'تمام، هنبعتلك فني تركيب' : 'محتاج فني تركيب؟'}
                  </span>
                  <span className={'mt-0.5 block text-sm ' + (installationChosen ? 'text-brand-fg/85' : 'text-muted')}>
                    {settings.installation.feePerMeterPiastres !== null
                      ? formatPiastres(settings.installation.feePerMeterPiastres) + ' للمتر من أفلام المقاس + انتقال حسب المنطقة'
                      : 'فني يركّبهولك'}
                  </span>
                  {settings.installation.note ? (
                    <span className={'mt-2 block text-xs ' + (installationChosen ? 'text-brand-fg/75' : 'text-muted')}>
                      {settings.installation.note}
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    'shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ' +
                    (installationChosen ? 'bg-brand-fg text-brand' : 'bg-brand text-brand-fg')
                  }
                >
                  {installationChosen ? 'مضاف ✓' : 'اطلب فني'}
                </span>
              </button>
              {installationBlocked ? (
                <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-fg">
                  <p className="font-semibold">
                    {selectedArea === ''
                      ? 'اختار منطقتك من القايمة عشان نحسب انتقال الفني.'
                      : 'الفني مش متاح في ' + selectedArea + ' حاليًا.'}
                  </p>
                  <p className="mt-1 text-muted">متاح في: {installerChoices.join('، ')}</p>
                  <p className="mt-1 text-muted">ممكن تكمل الطلب من غير فني وتختار أدوات التركيب المناسبة.</p>
                  <button type="button" onClick={chooseSelf} className={buttonClasses('secondary', 'md', 'mt-2 w-full')}>
                    {selfLabel}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <Field htmlFor="address" label="عنوان التوصيل" error={show('address')}>
            <textarea
              id="address"
              name="address"
              autoComplete="street-address"
              placeholder="المدينة، الشارع، رقم العمارة والدور، وأقرب علامة مميزة"
              value={values.address}
              onChange={(event) => set({ address: event.target.value })}
              className={textareaClasses}
            />
          </Field>

          {showNotes ? (
            <Field htmlFor="notes" label="ملاحظات (اختياري)">
              <textarea
                id="notes"
                name="notes"
                value={values.notes}
                onChange={(event) => set({ notes: event.target.value })}
                className={textareaClasses}
              />
            </Field>
          ) : (
            <button type="button" onClick={() => setShowNotes(true)} className="text-sm font-semibold text-accent">
              + ضيف ملاحظة للطلب
            </button>
          )}
        </div>
      </div>

      <div className="lg:col-span-5">
        <div className="space-y-4 lg:sticky lg:top-24">
          {/* الأصناف */}
          <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
            {entries.map((entry) => (
              <li key={entry.line.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-fg">{entry.product.name_ar}</p>
                  <p className="text-xs text-muted">
                    <Num>{describeLine(entry.product, entry.line)}</Num>
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-fg">
                  <Num>
                    {formatPiastres(lineTotalPiastres(entry.product, entry.line))}
                  </Num>
                </span>
              </li>
            ))}
          </ul>

          <OrderSummary
            subtotalPiastres={subtotal}
            shippingPiastres={shipping}
            installationPiastres={installationFee}
            installationTravelPiastres={installationReady ? travel : null}
            trustLine={settings.content.trustLine}
            gift={settings.offerEnabled ? settings.offerText : ''}
          />

          <Button type="submit" size="lg" disabled={submitting || submitBlocked}>
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                بنسجّل الطلب…
              </span>
            ) : (
              'تأكيد الطلب · الدفع عند الاستلام'
            )}
          </Button>

          {/*
            الخطأ جنب الزر، والسلة والبيانات زي ما هي — ممنوع نضيّع شغل الزبون
            على خطأ. الرسالة **دايماً** من السيرفر (جدول §1.3) مش من الاستثناء.
          */}
          {failure !== null ? (
            <p className="text-center text-xs font-medium text-danger">{failure}</p>
          ) : submitBlocked ? (
            <p className="text-center text-xs font-medium text-danger">اختار منطقة متاح فيها الفني، أو «هركّبه بنفسي».</p>
          ) : touched && invalid ? (
            <p className="text-center text-xs font-medium text-danger">راجع البيانات المطلوبة</p>
          ) : null}
        </div>
      </div>
    </form>
  )
}
