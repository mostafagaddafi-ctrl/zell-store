'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  computeShippingPiastres,
  computeSubtotalPiastres,
  formatLength,
  formatPiastres,
  hasErrors,
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
  const [touched, setTouched] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const router = useRouter()
  const abortRef = useRef<AbortController | null>(null)

  const byId = useMemo(() => {
    const map = new Map<number, StoreProduct>()
    for (const product of products) map.set(product.id, product)
    return map
  }, [products])

  const entries = cart.lines
    .map((line) => ({ line, product: byId.get(line.productId) }))
    .filter((entry): entry is { line: (typeof cart.lines)[number]; product: StoreProduct } => Boolean(entry.product))

  const subtotal = entries.reduce(
    (sum, entry) => sum + computeSubtotalPiastres(entry.product.price_per_meter_piastres, entry.line.lengthCm),
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

  const errors = validateCheckout(values, settings.governorates)
  const invalid = hasErrors(errors)

  const set = (patch: Partial<CheckoutValues>) => setValues({ ...values, ...patch })
  const show = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

  const items = entries.map((entry) => ({ productId: entry.product.id, lengthCm: entry.line.lengthCm }))

  async function submit(): Promise<void> {
    setTouched(true)
    setFailure(null)
    if (invalid || submitting || items.length === 0) return

    const payload = {
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      governorate: values.governorate,
      address: values.address,
      notes: values.notes.trim() === '' ? null : values.notes,
      items,
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
              onChange={(event) => set({ governorate: event.target.value })}
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
                    <Num>{formatLength(entry.line.lengthCm)}</Num>
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-fg">
                  <Num>
                    {formatPiastres(
                      computeSubtotalPiastres(entry.product.price_per_meter_piastres, entry.line.lengthCm),
                    )}
                  </Num>
                </span>
              </li>
            ))}
          </ul>

          <OrderSummary subtotalPiastres={subtotal} shippingPiastres={shipping} trustLine={settings.content.trustLine} />

          <Button type="submit" size="lg" disabled={submitting}>
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
          ) : touched && invalid ? (
            <p className="text-center text-xs font-medium text-danger">راجع البيانات المطلوبة</p>
          ) : null}
        </div>
      </div>
    </form>
  )
}
