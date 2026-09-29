'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Info } from 'lucide-react'
import {
  computeShippingPiastres,
  computeSubtotalPiastres,
  formatPiastres,
  hasErrors,
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

      {/*
        مرحلة ١: إنشاء الطلب مش مربوط — بقرار صريح.
        ومفيش أي مسار بديل لإرسال الطلب من الصفحة دي (واتساب اتشال عن قصد)
        عشان ما يتفهمش إنه إنشاء طلب. واتساب للاستفسار بس ومكانه الصفحة الرئيسية.
      */}
      <div className="flex gap-3 rounded-2xl border border-gold/50 bg-card p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-fg">تأكيد الطلب لسه مش مفعّل في النسخة دي</p>
          <p className="text-xs leading-relaxed text-muted">
            المتجر الجديد لسه في مرحلة البناء. إنشاء الطلب هيتربط بـ Server API مع تحقق وحد
            للمحاولات ومفتاح تكرار في المرحلة الجاية.
          </p>
        </div>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto max-w-app space-y-2">
          <button type="submit" disabled className={buttonClasses('primary', 'lg')}>
            تأكيد الطلب (قريباً)
          </button>
          {touched && invalid ? (
            <p className="text-center text-xs font-medium text-danger">راجع البيانات المطلوبة فوق</p>
          ) : null}
        </div>
      </div>
    </form>
  )
}
