'use client'

import {
  DELIVERY_PERIODS,
  DELIVERY_PERIOD_LABELS,
  PREFERRED_DELIVERY_MAX_DAYS,
  PREFERRED_DELIVERY_NOTE_MAX,
  addDaysIso,
  type DeliveryPeriodTime,
  type PreferredDeliveryDraft,
} from '@zell/core'
import { Field, inputClasses } from '../ui/Field'

/**
 * 0021-D — موعد التسليم المفضّل في Checkout (اختياري): تاريخ + فترة + ملاحظة قصيرة.
 * الأوقات جنب كل فترة من الداتابيز (periods)؛ لو مش متاحة بتظهر الأسماء بس. الموعد طلب من العميل، والتأكيد من فريقنا.
 */
export function PreferredDeliveryField({
  value,
  onChange,
  periods,
  today,
}: {
  value: PreferredDeliveryDraft
  onChange: (next: PreferredDeliveryDraft) => void
  periods: DeliveryPeriodTime[] | null
  today: string
}) {
  const timeOf = (period: string) => {
    const row = periods?.find((item) => item.period === period)
    return row ? ' (' + row.startsAt + '–' + row.endsAt + ')' : ''
  }
  return (
    <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
      <legend className="px-1 text-sm font-bold text-fg">موعد التسليم المفضّل (اختياري)</legend>
      <p className="text-xs text-muted">اختار اليوم والفترة اللي تناسبك، وهنكلمك نأكد الموعد.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="preferred-date" label="التاريخ">
          <input
            id="preferred-date"
            type="date"
            min={today}
            max={addDaysIso(today, PREFERRED_DELIVERY_MAX_DAYS)}
            value={value.date}
            onChange={(event) => onChange({ ...value, date: event.target.value })}
            className={inputClasses}
          />
        </Field>
        <Field htmlFor="preferred-period" label="الفترة">
          <select
            id="preferred-period"
            value={value.period}
            onChange={(event) => onChange({ ...value, period: event.target.value })}
            className={inputClasses}
          >
            <option value="">أي وقت</option>
            {DELIVERY_PERIODS.map((period) => (
              <option key={period} value={period}>
                {DELIVERY_PERIOD_LABELS[period] + timeOf(period)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field htmlFor="preferred-note" label="ملاحظة للمندوب (اختياري)">
        <input
          id="preferred-note"
          value={value.note}
          maxLength={PREFERRED_DELIVERY_NOTE_MAX}
          placeholder="مثلًا: كلّمني قبلها بساعة"
          onChange={(event) => onChange({ ...value, note: event.target.value })}
          className={inputClasses}
        />
      </Field>
    </fieldset>
  )
}
