'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Info, MessageCircle } from 'lucide-react'
import {
  computeShippingPiastres,
  computeSubtotalPiastres,
  formatLength,
  formatPiastres,
  hasErrors,
  normalizePhone,
  validateCheckout,
  type CheckoutValues,
  type StoreProduct,
  type StoreSettings,
} from '@zell/core'
import { useCart } from '../../lib/cart'
import { buttonClasses } from '../ui/Button'
import { Field, inputClasses, textareaClasses } from '../ui/Field'
import { Num } from './Num'

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
    : 0

  const total = subtotal + shipping
  const errors = validateCheckout(values, settings.governorates)
  const invalid = hasErrors(errors)

  const set = (patch: Partial<CheckoutValues>) => setValues({ ...values, ...patch })
  const show = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

  const whatsappHref = useMemo(() => {
    if (!settings.whatsappNumber) return null
    const lines: string[] = ['طلب جديد من موقع ' + settings.storeName, '']
    for (const entry of entries) {
      lines.push('• ' + entry.product.name_ar + ' — ' + formatLength(entry.line.lengthCm))
    }
    lines.push('')
    lines.push('الإجمالي قبل الشحن: ' + formatPiastres(subtotal))
    if (values.customerName.trim()) lines.push('الاسم: ' + values.customerName.trim())
    if (values.customerPhone.trim()) lines.push('الموبايل: ' + normalizePhone(values.customerPhone))
    if (values.governorate) lines.push('المحافظة: ' + values.governorate)
    if (values.address.trim()) lines.push('العنوان: ' + values.address.trim())
    if (values.notes.trim()) lines.push('ملاحظات: ' + values.notes.trim())
    return 'https://wa.me/' + settings.whatsappNumber + '?text=' + encodeURIComponent(lines.join('\n'))
  }, [entries, settings, subtotal, values])

  if (cart.ready && entries.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card py-12 text-center">
        <p className="text-sm text-muted">السلة فاضية.</p>
        <Link href="/" className={buttonClasses('primary', 'md', 'mt-4 inline-flex')}>
          شوف الأنواع
        </Link>
      </div>
    )
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
      }}
    >
      <div className="space-y-4">
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
          <button type="button" onClick={() => setShowNotes(true)} className="text-sm font-semibold text-brand">
            + ضيف ملاحظة للطلب
          </button>
        )}
      </div>

      {/* ملخص الحساب */}
      <div className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">الأصناف</span>
          <span className="font-semibold text-fg">
            <Num>{formatPiastres(subtotal)}</Num>
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">الشحن</span>
          <span className="font-semibold text-fg">
            {values.governorate ? <Num>{formatPiastres(shipping)}</Num> : 'اختار المحافظة'}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2 text-base">
          <span className="font-bold text-fg">الإجمالي</span>
          <span className="font-extrabold text-brand">
            <Num>{formatPiastres(total)}</Num>
          </span>
        </div>
        <p className="pt-1 text-xs text-muted">الدفع عند الاستلام.</p>
      </div>

      {/* مرحلة ١: إنشاء الطلب لسه مش مربوط بالسيرفر — بقرار صريح */}
      <div className="flex gap-3 rounded-2xl border border-gold/50 bg-card p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-fg">تأكيد الطلب لسه مش مفعّل في النسخة دي</p>
          <p className="text-xs leading-relaxed text-muted">
            المتجر الجديد لسه في مرحلة البناء. إنشاء الطلب هيتربط بـ Vercel Server API مع تحقق وحد
            للمحاولات ومفتاح تكرار في المرحلة الجاية. لحد كده ابعتلنا الطلب على واتساب.
          </p>
        </div>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto max-w-app space-y-2">
          <button type="submit" disabled className={buttonClasses('primary', 'lg')}>
            تأكيد الطلب (قريباً)
          </button>
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('whatsapp', 'lg')}
            >
              <MessageCircle className="h-5 w-5" />
              ابعت الطلب على واتساب
            </a>
          ) : null}
          {touched && invalid ? (
            <p className="text-center text-xs font-medium text-danger">راجع البيانات المطلوبة فوق</p>
          ) : null}
        </div>
      </div>
    </form>
  )
}
