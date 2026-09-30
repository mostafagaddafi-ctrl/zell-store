'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Info } from 'lucide-react'
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
import { useCart } from '../../lib/cart'
import { Button, buttonClasses } from '../ui/Button'
import { Field, inputClasses, textareaClasses } from '../ui/Field'
import { Num } from './Num'
import { OrderSummary } from './OrderSummary'

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
    : null

  const errors = validateCheckout(values, settings.governorates)
  const invalid = hasErrors(errors)

  const set = (patch: Partial<CheckoutValues>) => setValues({ ...values, ...patch })
  const show = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

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
        setTouched(true)
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

          <OrderSummary subtotalPiastres={subtotal} shippingPiastres={shipping} />

          {/*
            مرحلة البناء: إنشاء الطلب مش مربوط بقرار صريح.
            شريط جانبي خفيف مش صندوق جوه صندوق.
          */}
          <div className="flex gap-3 border-s-2 border-gold bg-card p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-fg">تأكيد الطلب لسه مش مفعّل</p>
              <p className="text-xs leading-relaxed text-muted">
                المتجر في مرحلة التجهيز. لأي استفسار أو طلب دلوقتي كلّمنا على واتساب من فوق.
              </p>
            </div>
          </div>

          <Button type="submit" size="lg" disabled>
            تأكيد الطلب (قريباً)
          </Button>

          {touched && invalid ? (
            <p className="text-center text-xs font-medium text-danger">راجع البيانات المطلوبة</p>
          ) : null}
        </div>
      </div>
    </form>
  )
}
