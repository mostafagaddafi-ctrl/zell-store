'use client'

import { ChevronDown, Loader2, Tag } from 'lucide-react'
import { formatPiastres } from '@zell/core'
import { DISCOUNT_SIGN } from '../../lib/orders/coupon'
import { COUPON_LOCK_MESSAGE, minSubtotalMessage, type CouponEstimate } from '../../lib/orders/couponCheckout'
import type { CheckoutCoupon } from '../../lib/useCheckoutCoupon'
import { Button } from '../ui/Button'
import { inputClasses } from '../ui/Field'
import { Num } from './Num'

/**
 * «معاك كود خصم؟» (0019 · PR4) — جزء صغير مقفول افتراضيًا جنب ملخص الطلب.
 *
 * 🔒 التطبيق بالزرار بس (مفيش تطبيق أثناء الكتابة)، والرسايل من جدول الأخطاء بس.
 * ⚠️ Enter جوه الخانة = «تطبيق» مش تأكيد الطلب — الخانة جوه فورم الطلب.
 * ⚠️ زرار «شيل الكود» هنا للكوبون بس، ومنفصل تمامًا عن «شيل أدوات التركيب».
 */
export function CouponBox({ coupon, estimate }: { coupon: CheckoutCoupon; estimate: CouponEstimate }) {
  const { state } = coupon
  const checking = state.phase === 'checking'
  const panelId = 'coupon-panel'
  const errorId = 'coupon-error'

  const removeButton = (
    <button
      type="button"
      onClick={coupon.remove}
      disabled={state.locked || checking}
      className="shrink-0 text-xs font-semibold text-danger underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
    >
      شيل الكود
    </button>
  )

  return (
    <section aria-label="كود الخصم" className="rounded-lg border border-border bg-card p-4 text-sm">
      <button
        type="button"
        aria-expanded={state.open}
        aria-controls={panelId}
        onClick={coupon.toggle}
        className="flex w-full items-center justify-between gap-3 font-semibold text-fg"
      >
        <span className="inline-flex items-center gap-2">
          <Tag className="h-4 w-4 text-brand" aria-hidden="true" />
          معاك كود خصم؟
        </span>
        <ChevronDown
          className={'h-4 w-4 text-muted transition-transform' + (state.open ? ' rotate-180' : '')}
          aria-hidden="true"
        />
      </button>

      {state.open ? (
        <div id={panelId} className="mt-3 space-y-2">
          {state.applied !== null ? (
            <>
              <div role="status" className="flex items-center justify-between gap-3 rounded-md bg-accent/10 px-3 py-2">
                <span className="min-w-0 font-semibold text-fg">
                  خصم (<bdi className="font-mono">{state.applied.code}</bdi>)
                  {estimate.kind === 'ok' ? (
                    <>
                      {': '}
                      <Num>{DISCOUNT_SIGN + formatPiastres(estimate.discountPiastres)}</Num>
                    </>
                  ) : null}
                </span>
                {removeButton}
              </div>
              {!state.locked && estimate.kind === 'below_minimum' ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {minSubtotalMessage(estimate.minSubtotalPiastres)}
                </p>
              ) : null}
              {!state.locked && estimate.kind === 'not_applicable' ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  الكود ده مالوش خصم على السلة دي. شيل الكود عشان تكمل.
                </p>
              ) : null}
              <p className="text-xs text-muted">تقدير — الخصم النهائي بيتأكد وقت تسجيل الطلب.</p>
            </>
          ) : (
            <>
              <label htmlFor="coupon-code" className="block text-xs font-semibold text-fg">
                كود الخصم
              </label>
              <div className="flex gap-2">
                <input
                  id="coupon-code"
                  name="coupon-code"
                  dir="ltr"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={40}
                  value={state.input}
                  disabled={checking || state.locked}
                  aria-invalid={state.phase === 'error'}
                  aria-describedby={state.error !== null ? errorId : undefined}
                  onChange={(event) => coupon.setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    coupon.apply()
                  }}
                  className={inputClasses + ' min-w-0 flex-1 text-left font-mono uppercase'}
                />
                <Button
                  variant="secondary"
                  onClick={coupon.apply}
                  disabled={checking || state.locked || state.input.trim() === ''}
                  aria-busy={checking}
                  className="shrink-0"
                >
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  تطبيق
                </Button>
              </div>
              {checking ? (
                <p role="status" className="text-xs text-muted">
                  {state.restoring ? 'بنتأكد من كود الخصم المحفوظ…' : 'بنتأكد من الكود…'}
                </p>
              ) : null}
              {state.error !== null ? (
                <div className="flex items-start justify-between gap-3">
                  <p id={errorId} ref={coupon.errorRef} tabIndex={-1} role="alert" className="text-xs font-medium text-danger outline-none">
                    {state.error}
                  </p>
                  {removeButton}
                </div>
              ) : null}
            </>
          )}

          {state.rejection !== null ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {state.rejection}
            </p>
          ) : null}
          {state.locked ? (
            <p role="status" className="rounded-md border border-border bg-bg p-2 text-xs font-medium text-fg">
              {COUPON_LOCK_MESSAGE}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
