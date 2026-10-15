'use client'

import { useActionState } from 'react'
import { Search } from 'lucide-react'
import { trackOrderAction } from '../../app/track/actions'
import { TRACK_INITIAL_STATE, TRACK_INPUT_MAX } from '../../lib/orders/trackOrder'
import { Field, inputClasses } from '../ui/Field'
import { Button } from '../ui/Button'
import { TrackOrderView } from './TrackOrderView'

/**
 * TRACK-ORDER — فورم «تتبّع طلبك» (العقود docs/contracts/TRACK-ORDER.md §٤ · TRACK-ORDER-v2.md §١٧-١).
 *
 *   • الفورم بيبعت الكود للـ Server Action في body الطلب (POST)، فالكود مابيدخلش الرابط.
 *   • النتيجة في TrackOrderView (خط المراحل والتفاصيل)، وكلها من الحارس.
 */
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
        {state.status === 'found' ? <TrackOrderView order={state.order} whatsappHref={state.whatsappHref} /> : null}
      </div>
    </div>
  )
}
