import { useState } from 'react'
import type { FormEvent } from 'react'
import { CheckCircle2, Loader2, MessageCircle, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import {
  computeSubtotalPiastres,
  formatLength,
  formatPiastres,
  isValidEgyptianPhone,
  normalizePhone,
} from '../../lib/core/pricing'
import type { CreatedOrder, StoreProduct } from '../../lib/core/types'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../lib/shadcn/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Textarea } from '../../lib/shadcn/textarea'
import { Num } from './Num'
import { ProductArt } from './ProductArt'

export type CartEntry = { lineId: string; product: StoreProduct; lengthCm: number; index: number }

export type CheckoutValues = {
  customerName: string
  customerPhone: string
  governorate: string
  address: string
  notes: string
}

type CartSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: CartEntry[]
  governorates: string[]
  shippingPiastres: number
  subtotalPiastres: number
  values: CheckoutValues
  onValuesChange: (values: CheckoutValues) => void
  onLengthChange: (lineId: string, lengthCm: number) => void
  onRemove: (lineId: string) => void
  onSubmit: () => void
  submitting: boolean
  errorMessage: string | null
  createdOrder: CreatedOrder | null
  whatsappHref: string | null
  onNewOrder: () => void
  onContinueShopping: () => void
}

export function CartSheet(props: CartSheetProps) {
  const { open, onOpenChange, entries, createdOrder } = props

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        dir="rtl"
        className="max-h-[92vh] overflow-y-auto rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
      >
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3 text-right">
          <SheetTitle className="text-right text-base">
            {createdOrder ? 'تم الطلب' : `سلة الطلب${entries.length > 0 ? ` (${entries.length})` : ''}`}
          </SheetTitle>
          <SheetDescription className="sr-only">
            مراجعة الأصناف وإدخال بيانات التوصيل وتأكيد الطلب
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 pt-3">
          {createdOrder ? (
            <Success order={createdOrder} whatsappHref={props.whatsappHref} onNewOrder={props.onNewOrder} />
          ) : entries.length === 0 ? (
            <EmptyCart onClose={props.onContinueShopping} />
          ) : (
            <Checkout {...props} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function EmptyCart({ onClose }: { onClose: () => void }) {
  return (
    <div className="py-10 text-center">
      <ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">السلة فاضية — اختار نوع الفيلم وحدد الطول.</p>
      <Button className="mt-4 h-11 rounded-xl" onClick={onClose}>
        شوف الأنواع
      </Button>
    </div>
  )
}

function Checkout({
  entries,
  governorates,
  shippingPiastres,
  subtotalPiastres,
  values,
  onValuesChange,
  onLengthChange,
  onRemove,
  onSubmit,
  submitting,
  errorMessage,
  onContinueShopping,
}: CartSheetProps) {
  const [showNotes, setShowNotes] = useState(false)
  const [touched, setTouched] = useState(false)

  const set = (patch: Partial<CheckoutValues>) => onValuesChange({ ...values, ...patch })

  const nameError = values.customerName.trim().length < 3 ? 'اكتب الاسم' : null
  const phoneError = !isValidEgyptianPhone(values.customerPhone) ? 'رقم موبايل غير صحيح' : null
  const govError = !values.governorate ? 'اختر المحافظة' : null
  const addressError = values.address.trim().length < 8 ? 'اكتب العنوان بالتفصيل' : null
  const invalid = Boolean(nameError || phoneError || govError || addressError)

  const total = subtotalPiastres + (values.governorate ? shippingPiastres : 0)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (invalid) return
    onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ١ — الأصناف */}
      <div>
        <StepTitle number="١" title="مراجعة الطلب" />
        <ul className="mt-2 space-y-2">
          {entries.map((entry) => {
            const line = computeSubtotalPiastres(entry.product.price_per_meter_piastres, entry.lengthCm)
            const step = (delta: number) => {
              const next = entry.lengthCm + delta * entry.product.step_cm
              if (next < entry.product.min_length_cm || next > entry.product.max_length_cm) return
              onLengthChange(entry.lineId, next)
            }
            return (
              <li key={entry.lineId} className="flex items-center gap-3 rounded-xl border border-border p-2">
                <ProductArt
                  src={entry.product.image_url}
                  alt={entry.product.name_ar}
                  nameEn={entry.product.name_en}
                  seed={entry.index}
                  className="h-14 w-14 shrink-0 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{entry.product.name_ar}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="قلّل"
                      onClick={() => step(-1)}
                      disabled={entry.lengthCm <= entry.product.min_length_cm}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="min-w-16 text-center text-xs font-bold">{formatLength(entry.lengthCm)}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="زوّد"
                      onClick={() => step(1)}
                      disabled={entry.lengthCm >= entry.product.max_length_cm}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold">{formatPiastres(line)}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`احذف ${entry.product.name_ar}`}
                    onClick={() => onRemove(entry.lineId)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          onClick={onContinueShopping}
          className="mt-2 text-xs text-primary underline-offset-4 hover:underline"
        >
          + ضيف شباك تاني
        </button>
      </div>

      {/* ٢ — بيانات التوصيل */}
      <div>
        <StepTitle number="٢" title="بيانات التوصيل" />
        <div className="mt-2 space-y-2">
          <Input
            value={values.customerName}
            onChange={(e) => set({ customerName: e.target.value })}
            placeholder="الاسم بالكامل"
            autoComplete="name"
            className="h-12 rounded-xl"
          />
          {touched && nameError ? <FieldError text={nameError} /> : null}

          <Input
            dir="ltr"
            inputMode="tel"
            value={values.customerPhone}
            onChange={(e) => set({ customerPhone: normalizePhone(e.target.value) })}
            placeholder="01xxxxxxxxx"
            autoComplete="tel"
            className="h-12 rounded-xl text-left"
          />
          {touched && phoneError ? <FieldError text={phoneError} /> : null}

          <Select value={values.governorate} onValueChange={(value) => set({ governorate: value })}>
            <SelectTrigger className="h-12 rounded-xl">
              <SelectValue placeholder="المحافظة (عشان نحسب الشحن)" />
            </SelectTrigger>
            <SelectContent>
              {governorates.map((gov) => (
                <SelectItem key={gov} value={gov}>
                  {gov}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {touched && govError ? <FieldError text={govError} /> : null}

          <Input
            value={values.address}
            onChange={(e) => set({ address: e.target.value })}
            placeholder="العنوان: المنطقة، الشارع، رقم العقار"
            autoComplete="street-address"
            className="h-12 rounded-xl"
          />
          {touched && addressError ? <FieldError text={addressError} /> : null}

          {showNotes ? (
            <Textarea
              value={values.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="ملاحظات (اختياري)"
              rows={2}
              className="rounded-xl"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              إضافة ملاحظة (اختياري)
            </button>
          )}
        </div>
      </div>

      {/* ٣ — التأكيد */}
      <div>
        <StepTitle number="٣" title="الدفع عند الاستلام" />
        <dl className="mt-2 space-y-1.5 rounded-xl bg-muted/50 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">الأصناف</dt>
            <dd>{formatPiastres(subtotalPiastres)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">الشحن</dt>
            <dd>
              {values.governorate ? (
                shippingPiastres === 0 ? (
                  'مجاني'
                ) : (
                  formatPiastres(shippingPiastres)
                )
              ) : (
                <span className="text-muted-foreground">اختر المحافظة</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
            <dt>الإجمالي</dt>
            <dd>{formatPiastres(total)}</dd>
          </div>
        </dl>
      </div>

      {errorMessage ? (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p>
      ) : null}

      <Button type="submit" disabled={submitting} className="h-14 w-full rounded-xl text-base font-bold">
        {submitting ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : null}
        تأكيد الطلب
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        مش هتدفع أي حاجة دلوقتي — بنكلّمك الأول نتأكد من الطلب.
      </p>
    </form>
  )
}

function StepTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {number}
      </span>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
    </div>
  )
}

function FieldError({ text }: { text: string }) {
  return <p className="px-1 text-xs text-destructive">{text}</p>
}

function Success({
  order,
  whatsappHref,
  onNewOrder,
}: {
  order: CreatedOrder
  whatsappHref: string | null
  onNewOrder: () => void
}) {
  return (
    <div className="py-4 text-center">
      <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
      <h3 className="mt-3 text-lg font-bold">تم استلام طلبك</h3>

      <div className="mx-auto mt-4 inline-block rounded-xl border border-dashed border-border bg-muted/40 px-5 py-3">
        <span className="block text-xs text-muted-foreground">رقم الطلب — احتفظ بيه</span>
        <span className="mt-0.5 block font-mono text-xl font-bold">
          <Num>{order.order_number}</Num>
        </span>
      </div>

      <ul className="mx-auto mt-4 max-w-sm space-y-1 text-right text-sm">
        {order.items.map((item, index) => (
          <li key={`${item.product_name_ar}-${index}`} className="flex justify-between gap-2">
            <span className="text-muted-foreground">
              {item.product_name_ar} — {formatLength(item.length_cm)}
            </span>
            <span>{formatPiastres(item.line_total_piastres)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-2 border-t border-border pt-1 font-bold">
          <span>الإجمالي عند الاستلام</span>
          <span>{formatPiastres(order.total_piastres)}</span>
        </li>
      </ul>

      <div className="mx-auto mt-4 max-w-sm rounded-xl bg-muted/50 p-3 text-right text-xs leading-6 text-muted-foreground">
        الخطوة الجاية: هنكلّمك على{' '}
        <strong className="text-foreground">
          <Num>{order.customer_phone}</Num>
        </strong>{' '}
        نأكد الطلب وميعاد التوصيل، وبعدها يوصلك خلال ٢–٤ أيام حسب المحافظة. الدفع كاش للمندوب.
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {whatsappHref ? (
          <Button asChild className="h-12 rounded-xl">
            <a href={whatsappHref} target="_blank" rel="noreferrer">
              <MessageCircle className="ml-2 h-4 w-4" />
              ابعتلنا رقم الطلب على واتساب
            </a>
          </Button>
        ) : null}
        <Button variant="outline" className="h-12 rounded-xl" onClick={onNewOrder}>
          تمام، اقفل
        </Button>
      </div>
    </div>
  )
}
