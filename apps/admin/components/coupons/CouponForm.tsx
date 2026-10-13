'use client'

import { useRef, useState } from 'react'
import { createCouponAction, updateCouponAction } from '../../lib/couponActions'
import {
  COUPON_NOTE_MAX,
  couponIdentityLocked,
  couponToForm,
  emptyCouponForm,
  formToCouponInput,
  validateCouponInput,
  type AdminCoupon,
  type CouponFormState,
} from '../../lib/coupons/form'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * إنشاء أو تعديل كوبون. المبالغ بالجنيه في الخانات وبالقرش في التخزين.
 * التحقق هنا للراحة بس — السيرفر بيعيده كامل (lib/mutations/coupons) قبل أي كتابة.
 * الكود والنوع مقفولين بعد أول استخدام (والسيرفر بيرفض تغييرهم حتى لو الخانة اتفتحت).
 */
export function CouponForm({
  coupon,
  onClose,
  onSaved,
}: {
  coupon: AdminCoupon | null
  onClose: () => void
  onSaved: () => void
}) {
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry, markDirty } = useSaveAction()
  const [form, setForm] = useState<CouponFormState>(() => (coupon ? couponToForm(coupon) : emptyCouponForm()))
  const [localError, setLocalError] = useState<string | null>(null)
  const formRef = useRef(form)
  formRef.current = form

  const busy = state === 'saving'
  // نفس قاعدة السيرفر: أي أوردر بيشاور على الكوبون (حتى الملغي) بيقفل الكود والنوع
  const identityLocked = coupon !== null && couponIdentityLocked(coupon)
  const lockedHint = 'مقفول بعد أول استخدام'

  function set(patch: Partial<CouponFormState>) {
    setForm((current) => ({ ...current, ...patch }))
    setLocalError(null)
    markDirty()
  }

  function submit() {
    const parsed = formToCouponInput(formRef.current)
    if (!parsed.ok) {
      setLocalError(parsed.message)
      return
    }
    const checked = validateCouponInput(parsed.value)
    if (!checked.ok) {
      setLocalError(checked.message)
      return
    }
    const input = parsed.value
    void run(() => (coupon ? updateCouponAction(coupon.id, input, coupon.updatedAt) : createCouponAction(input)), {
      onSuccess: () => onSaved(),
    })
  }

  return (
    <Card
      title={coupon ? 'تعديل ' + coupon.code : 'كوبون جديد'}
      actions={
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          إلغاء
        </Button>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="coupon-code" label="الكود" hint={identityLocked ? lockedHint : '٤–٣٢ حرف إنجليزي أو رقم أو - أو _'}>
            <input
              id="coupon-code"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              value={form.code}
              disabled={identityLocked || busy}
              onChange={(event) => set({ code: event.target.value })}
              className={inputClasses + ' font-mono uppercase'}
            />
          </Field>

          <Field htmlFor="coupon-kind" label="نوع الخصم" hint={identityLocked ? lockedHint : undefined}>
            <select
              id="coupon-kind"
              value={form.kind}
              disabled={identityLocked || busy}
              onChange={(event) => set({ kind: event.target.value === 'fixed' ? 'fixed' : 'percent' })}
              className={inputClasses}
            >
              <option value="percent">نسبة من الأصناف</option>
              <option value="fixed">مبلغ ثابت</option>
            </select>
          </Field>

          {form.kind === 'percent' ? (
            <>
              <Field htmlFor="coupon-percent" label="النسبة %" hint="رقم صحيح من ١ لـ ٩٠">
                <input
                  id="coupon-percent"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.percent}
                  disabled={busy}
                  onChange={(event) => set({ percent: event.target.value })}
                  className={inputClasses}
                />
              </Field>
              <Field htmlFor="coupon-cap" label="أقصى خصم (جنيه)" hint="فاضي = من غير حد أقصى">
                <input
                  id="coupon-cap"
                  dir="ltr"
                  inputMode="decimal"
                  value={form.cap}
                  disabled={busy}
                  onChange={(event) => set({ cap: event.target.value })}
                  className={inputClasses}
                />
              </Field>
            </>
          ) : (
            <Field htmlFor="coupon-amount" label="مبلغ الخصم (جنيه)" hint="مابيعدّيش إجمالي الأصناف">
              <input
                id="coupon-amount"
                dir="ltr"
                inputMode="decimal"
                value={form.amount}
                disabled={busy}
                onChange={(event) => set({ amount: event.target.value })}
                className={inputClasses}
              />
            </Field>
          )}

          <Field htmlFor="coupon-min" label="الحد الأدنى للأصناف (جنيه)" hint="فاضي = من غير حد أدنى">
            <input
              id="coupon-min"
              dir="ltr"
              inputMode="decimal"
              value={form.minSubtotal}
              disabled={busy}
              onChange={(event) => set({ minSubtotal: event.target.value })}
              className={inputClasses}
            />
          </Field>

          <Field htmlFor="coupon-starts" label="البداية" hint="فاضي = من دلوقتي">
            <input
              id="coupon-starts"
              type="datetime-local"
              dir="ltr"
              value={form.startsAt}
              disabled={busy}
              onChange={(event) => set({ startsAt: event.target.value })}
              className={inputClasses}
            />
          </Field>

          <Field htmlFor="coupon-ends" label="النهاية" hint="فاضي = من غير نهاية">
            <input
              id="coupon-ends"
              type="datetime-local"
              dir="ltr"
              value={form.endsAt}
              disabled={busy}
              onChange={(event) => set({ endsAt: event.target.value })}
              className={inputClasses}
            />
          </Field>

          <Field htmlFor="coupon-max" label="الحد الإجمالي للاستخدام" hint="الحقل الفارغ يعني بلا حد، ولا تُحتسب الطلبات الملغاة.">
            <input
              id="coupon-max"
              dir="ltr"
              inputMode="numeric"
              value={form.maxUses}
              disabled={busy}
              onChange={(event) => set({ maxUses: event.target.value })}
              className={inputClasses}
            />
          </Field>

          <Field htmlFor="coupon-phone" label="الحد لكل موبايل" hint="الافتراضي ١. فاضي = من غير حد">
            <input
              id="coupon-phone"
              dir="ltr"
              inputMode="numeric"
              value={form.maxUsesPerPhone}
              disabled={busy}
              onChange={(event) => set({ maxUsesPerPhone: event.target.value })}
              className={inputClasses}
            />
          </Field>
        </div>

        <label className="flex w-fit items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={form.isActive}
            disabled={busy}
            onChange={(event) => set({ isActive: event.target.checked })}
          />
          فعّال
        </label>

        <Field
          htmlFor="coupon-note"
          label="ملاحظة داخلية (اختياري)"
          hint={String(Array.from(form.note.trim()).length) + ' / ' + String(COUPON_NOTE_MAX) + ' — لا تظهر للعميل'}
        >
          <textarea
            id="coupon-note"
            value={form.note}
            disabled={busy}
            onChange={(event) => set({ note: event.target.value })}
            className={textareaClasses}
          />
        </Field>

        {localError !== null ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {localError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {state === 'saved' ? <span className="text-xs text-ok">اتحفظ</span> : null}
          <Button type="submit" disabled={!mutationsOn || busy}>
            {busy ? 'بيحفظ…' : coupon ? 'حفظ التعديلات' : 'إنشاء الكوبون'}
          </Button>
        </div>

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={onSaved} />
      </form>
    </Card>
  )
}
