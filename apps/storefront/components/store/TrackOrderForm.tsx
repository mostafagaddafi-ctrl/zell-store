'use client'

import { useActionState } from 'react'
import { Search } from 'lucide-react'
import { formatPiastres } from '@zell/core'
import { trackOrderAction } from '../../app/track/actions'
import {
  TRACK_INITIAL_STATE,
  TRACK_INPUT_MAX,
  customerStatusLabel,
  trackDeliveryView,
  trackItemSpec,
  type TrackedOrder,
} from '../../lib/orders/trackOrder'
import { Field, inputClasses } from '../ui/Field'
import { Button } from '../ui/Button'
import { Num } from './Num'

/**
 * TRACK-ORDER W2 — فورم «تتبّع طلبك» والنتيجة (العقد docs/contracts/TRACK-ORDER.md §٤).
 *
 *   • الفورم بيبعت الكود للـ Server Action في body الطلب (POST)، فالكود مابيدخلش الرابط.
 *   • المعروض: الحالة (أسماء العميل) · رقم الطلب والتاريخ · الموعد · المنتجات · الإجمالي — من غير أي بيانات عميل.
 */

// توقيت ثابت للعميل، زي الإيصال — مش توقيت السيرفر.
const TIME_ZONE = 'Africa/Cairo'

export function TrackOrderForm() {
  const [state, formAction, pending] = useActionState(trackOrderAction, TRACK_INITIAL_STATE)

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Field htmlFor="track-code" label="رقم الطلب" hint="هتلاقيه في صفحة تأكيد الطلب، وشكله FLM-XXXXXX.">
          <input
            id="track-code"
            name="code"
            type="text"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={TRACK_INPUT_MAX}
            dir="ltr"
            placeholder="FLM-XXXXXX"
            className={inputClasses}
          />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          <Search className="h-5 w-5" />
          {pending ? 'بندوّر على الطلب…' : 'تتبّع الطلب'}
        </Button>
      </form>

      <div aria-live="polite">
        {state.status === 'not_found' ? (
          <p role="alert" className="rounded-lg border border-border bg-card p-4 text-sm text-fg">
            {state.message}
          </p>
        ) : null}
        {state.status === 'found' ? <TrackedOrderView order={state.order} /> : null}
      </div>
    </div>
  )
}

function TrackedOrderView({ order }: { order: TrackedOrder }) {
  const delivery = trackDeliveryView(order.delivery)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-xs text-muted">حالة الطلب</p>
        <p className="mt-1 text-lg font-bold text-fg">{customerStatusLabel(order.status)}</p>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
        <div className="bg-card p-4">
          <dt className="text-xs text-muted">رقم الطلب</dt>
          <dd className="mt-1 font-mono text-sm font-bold text-fg" dir="ltr">
            {order.orderNumber}
          </dd>
        </div>
        <div className="bg-card p-4">
          <dt className="text-xs text-muted">تاريخ الطلب</dt>
          <dd className="mt-1 text-sm font-semibold text-fg">
            <Num>{new Date(order.createdAt).toLocaleDateString('ar-EG', { timeZone: TIME_ZONE })}</Num>
          </dd>
        </div>
      </dl>

      {delivery !== null ? (
        <div className="rounded-lg border border-border bg-card p-4">
          {delivery.note !== null ? <p className="text-xs text-muted">{delivery.note}</p> : null}
          <p className={delivery.note !== null ? 'mt-1 text-sm font-semibold text-fg' : 'text-sm font-semibold text-fg'}>
            <Num>{delivery.line}</Num>
          </p>
        </div>
      ) : null}

      {order.items.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
          {order.items.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-fg">{item.productName}</p>
                <p className="text-xs text-muted">
                  <Num>{trackItemSpec(item)}</Num>
                </p>
              </div>
              <span className="shrink-0 font-semibold text-fg">
                <Num>{formatPiastres(item.lineTotalPiastres)}</Num>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex justify-between rounded-lg border border-border bg-card p-4 text-base font-bold text-fg">
        <span>الإجمالي</span>
        <span>
          <Num>{formatPiastres(order.totalPiastres)}</Num>
        </span>
      </div>
    </div>
  )
}
