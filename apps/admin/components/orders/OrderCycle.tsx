'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { editOrderDetailsAction, recordOrderCallAction, setOrderDeliveryAction, setOrderFollowUpAction } from '../../lib/orderActions'
import {
  CALL_NOTE_MAX,
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  CALL_TEXT,
  CUSTOMER_TEXT,
  DELIVERY_NOTE_MAX,
  DELIVERY_PERIODS,
  DELIVERY_PERIOD_LABELS,
  DELIVERY_TEXT,
  FOLLOW_UP_FILTER_LABELS,
  FOLLOW_UP_TEXT,
  PHONE_LOCKED_MESSAGE,
  cairoInputToIso,
  callFormIssue,
  callPanelOpen,
  deliveryEditable,
  deliveryValue,
  detailsChanges,
  followUpBucket,
  followUpIssue,
  formatCairoDateTime,
  isoToCairoInput,
  periodLine,
  preferredLine,
  preferredTitle,
  type PreferredShown,
  type CallOutcome,
  type DeliveryPeriod,
  type DetailsCurrent,
  type PeriodsView,
} from '../../lib/orders/cycle'
import type { OrderStatus } from '../../lib/enums'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * 0021-A A2 — كروت دورة الطلب في صفحة الطلب: نتيجة التواصل · موعد المتابعة · موعد التسليم المتفق عليه · بيانات العميل.
 * كل كارت بيبعت آخر طابع (expectedUpdatedAt) وبيعمل refresh بعد النجاح؛ القرار النهائي في دوال zell_order_* .
 * الأوقات بتتدخّل وبتتعرض بتوقيت القاهرة. النصوص كلها من lib/orders/cycle.ts.
 */

function useStamp(expectedUpdatedAt: string) {
  const ref = useRef(expectedUpdatedAt)
  ref.current = expectedUpdatedAt
  return ref
}

function Issue({ text }: { text: string | null }) {
  return text === null ? null : <p className="text-xs font-medium text-danger">{text}</p>
}

function Done({ text }: { text: string | null }) {
  return text === null ? null : (
    <p role="status" className="text-xs text-ok">
      {text}
    </p>
  )
}

// ── نتيجة التواصل ─────────────────────────────────────────────────────
export function OrderCallCard({ orderId, status, expectedUpdatedAt }: { orderId: number; status: OrderStatus; expectedUpdatedAt: string }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const stampRef = useStamp(expectedUpdatedAt)
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [note, setNote] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [issue, setIssue] = useState<string | null>(null)

  if (!callPanelOpen(status)) return null
  const busy = state === 'saving'

  function submit() {
    const iso = outcome === 'callback_later' && followUp !== '' ? cairoInputToIso(followUp) : null
    const problem = callFormIssue(outcome, iso, note, Date.now())
    setIssue(problem)
    if (problem !== null || outcome === null) return
    if (outcome === 'customer_cancelled' && !window.confirm(CALL_TEXT.cancelledConfirm)) return
    const chosen = outcome
    void run(() => recordOrderCallAction(orderId, chosen, note, chosen === 'callback_later' ? iso : null, stampRef.current), {
      onSuccess: () => {
        setOutcome(null)
        setNote('')
        setFollowUp('')
        router.refresh()
      },
    })
  }

  return (
    <Card title={CALL_TEXT.title}>
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={CALL_TEXT.outcomeLabel}>
          {CALL_OUTCOMES.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={item === outcome ? 'primary' : 'secondary'}
              role="radio"
              aria-checked={item === outcome}
              disabled={!mutationsOn || busy}
              onClick={() => {
                setOutcome(item)
                setIssue(null)
              }}
            >
              {CALL_OUTCOME_LABELS[item]}
            </Button>
          ))}
        </div>

        {outcome === 'callback_later' ? (
          <Field htmlFor="call-follow-up" label={CALL_TEXT.followUpLabel} hint={CALL_TEXT.followUpHint}>
            <input
              id="call-follow-up"
              type="datetime-local"
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              className={inputClasses}
              disabled={!mutationsOn || busy}
            />
          </Field>
        ) : null}

        <Field htmlFor="call-note" label={CALL_TEXT.noteLabel}>
          <textarea
            id="call-note"
            value={note}
            maxLength={CALL_NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
            className={textareaClasses}
            disabled={!mutationsOn || busy}
          />
        </Field>

        {outcome === 'confirmed' ? <p className="text-xs text-muted">{CALL_TEXT.confirmedHint}</p> : null}
        {outcome === 'customer_cancelled' ? <p className="text-xs text-danger">{CALL_TEXT.cancelledHint}</p> : null}
        <Issue text={issue} />
        <Done text={state === 'saved' ? CALL_TEXT.saved : null} />

        <Button size="sm" disabled={!mutationsOn || busy} onClick={submit}>
          {busy ? CALL_TEXT.saving : CALL_TEXT.submit}
        </Button>
        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}

// ── موعد المتابعة ─────────────────────────────────────────────────────
export function OrderFollowUpCard({
  orderId,
  status,
  nextFollowUpAt,
  expectedUpdatedAt,
}: {
  orderId: number
  status: OrderStatus
  nextFollowUpAt: string | null
  expectedUpdatedAt: string
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const stampRef = useStamp(expectedUpdatedAt)
  const [value, setValue] = useState(isoToCairoInput(nextFollowUpAt))
  const [note, setNote] = useState('')
  const [issue, setIssue] = useState<string | null>(null)
  const [last, setLast] = useState<'saved' | 'cleared'>('saved')
  const busy = state === 'saving'
  const editable = callPanelOpen(status)
  const bucket = followUpBucket(nextFollowUpAt, status, Date.now())

  function save(clear: boolean) {
    const iso = clear ? null : cairoInputToIso(value)
    if (clear) {
      if (!window.confirm(FOLLOW_UP_TEXT.clearConfirm)) return
      setIssue(null)
    } else {
      const problem = followUpIssue(iso, Date.now())
      setIssue(problem)
      if (problem !== null) return
    }
    setLast(clear ? 'cleared' : 'saved')
    void run(() => setOrderFollowUpAction(orderId, iso, note, stampRef.current), {
      onSuccess: () => {
        setNote('')
        if (clear) setValue('')
        router.refresh()
      },
    })
  }

  return (
    <Card title={FOLLOW_UP_TEXT.title}>
      <div className="space-y-2.5">
        <p className="text-sm text-fg">
          {nextFollowUpAt === null ? FOLLOW_UP_TEXT.none : formatCairoDateTime(nextFollowUpAt)}
          {bucket !== null ? <span className="ms-2 text-xs font-semibold text-muted">{FOLLOW_UP_FILTER_LABELS[bucket]}</span> : null}
        </p>
        {editable ? (
          <>
            <Field htmlFor="follow-up-at" label={FOLLOW_UP_TEXT.inputLabel}>
              <input
                id="follow-up-at"
                type="datetime-local"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className={inputClasses}
                disabled={!mutationsOn || busy}
              />
            </Field>
            <Field htmlFor="follow-up-note" label={FOLLOW_UP_TEXT.noteLabel}>
              <input
                id="follow-up-note"
                value={note}
                maxLength={CALL_NOTE_MAX}
                onChange={(event) => setNote(event.target.value)}
                className={inputClasses}
                disabled={!mutationsOn || busy}
              />
            </Field>
            <Issue text={issue} />
            <Done text={state === 'saved' ? (last === 'cleared' ? FOLLOW_UP_TEXT.cleared : FOLLOW_UP_TEXT.saved) : null} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!mutationsOn || busy} onClick={() => save(false)}>
                {FOLLOW_UP_TEXT.save}
              </Button>
              {nextFollowUpAt !== null ? (
                <Button size="sm" variant="secondary" disabled={!mutationsOn || busy} onClick={() => save(true)}>
                  {FOLLOW_UP_TEXT.clear}
                </Button>
              ) : null}
            </div>
            <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
          </>
        ) : (
          <p className="text-xs text-muted">{FOLLOW_UP_TEXT.onlyNew}</p>
        )}
      </div>
    </Card>
  )
}

// ── موعد التسليم المتفق عليه ───────────────────────────────────────────
export type DeliveryShown = { date: string; period: DeliveryPeriod | null; note: string | null } | null

export function OrderDeliveryCard({
  orderId,
  status,
  delivery,
  periods,
  preferred = null,
  expectedUpdatedAt,
}: {
  orderId: number
  status: OrderStatus
  delivery: DeliveryShown
  periods: PeriodsView | null
  /** 0021-D — موعد العميل المفضّل من Checkout. */
  preferred?: PreferredShown | null
  expectedUpdatedAt: string
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const stampRef = useStamp(expectedUpdatedAt)
  const [date, setDate] = useState(delivery?.date ?? '')
  const [period, setPeriod] = useState<string>(delivery?.period ?? '')
  const [note, setNote] = useState(delivery?.note ?? '')
  const [issue, setIssue] = useState<string | null>(null)
  const [last, setLast] = useState<'saved' | 'cleared'>('saved')
  const busy = state === 'saving'
  const editable = deliveryEditable(status)

  function save(clear: boolean) {
    if (clear && !window.confirm(DELIVERY_TEXT.clearConfirm)) return
    const result = deliveryValue(clear ? { date: '', period: '', note: '' } : { date, period, note })
    if (!result.ok) {
      setIssue(result.message)
      return
    }
    setIssue(null)
    setLast(clear ? 'cleared' : 'saved')
    void run(() => setOrderDeliveryAction(orderId, result.value, stampRef.current), {
      onSuccess: () => {
        if (clear) {
          setDate('')
          setPeriod('')
          setNote('')
        }
        router.refresh()
      },
    })
  }

  return (
    <Card title={DELIVERY_TEXT.title}>
      <div className="space-y-2.5">
        {preferred !== null ? (
          <div className="rounded border border-gold bg-gold/10 p-2 text-xs text-fg">
            <p className="font-semibold">{preferredTitle(delivery !== null)}</p>
            <p className="mt-0.5">{preferredLine(preferred)}</p>
            {preferred.note !== null ? <p className="mt-0.5 text-muted">{preferred.note}</p> : null}
          </div>
        ) : null}
        <p className="text-sm text-fg">
          {delivery === null
            ? DELIVERY_TEXT.none
            : delivery.date + ' · ' + (delivery.period !== null ? DELIVERY_PERIOD_LABELS[delivery.period] : DELIVERY_TEXT.noPeriod)}
        </p>
        {delivery !== null && delivery.note !== null ? <p className="text-xs text-muted">{delivery.note}</p> : null}
        <p className="text-xs text-muted">{DELIVERY_TEXT.hint}</p>

        <div className="rounded border border-border bg-bg p-2 text-xs text-muted">
          <p className="mb-1 font-semibold text-fg">{DELIVERY_TEXT.periodsTitle}</p>
          {periods === null ? (
            <p>{DELIVERY_TEXT.periodsUnavailable}</p>
          ) : (
            <ul className="space-y-0.5">
              {periods.periods.map((row) => (
                <li key={row.period} dir="rtl">
                  {periodLine(row)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {editable ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field htmlFor="delivery-date" label={DELIVERY_TEXT.dateLabel}>
                <input
                  id="delivery-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className={inputClasses}
                  disabled={!mutationsOn || busy}
                />
              </Field>
              <Field htmlFor="delivery-period" label={DELIVERY_TEXT.periodLabel}>
                <select
                  id="delivery-period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  className={inputClasses}
                  disabled={!mutationsOn || busy}
                >
                  <option value="">{DELIVERY_TEXT.noPeriod}</option>
                  {DELIVERY_PERIODS.map((item) => (
                    <option key={item} value={item}>
                      {DELIVERY_PERIOD_LABELS[item]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field htmlFor="delivery-note" label={DELIVERY_TEXT.noteLabel}>
              <input
                id="delivery-note"
                value={note}
                maxLength={DELIVERY_NOTE_MAX}
                onChange={(event) => setNote(event.target.value)}
                className={inputClasses}
                disabled={!mutationsOn || busy}
              />
            </Field>
            <Issue text={issue} />
            <Done text={state === 'saved' ? (last === 'cleared' ? DELIVERY_TEXT.cleared : DELIVERY_TEXT.saved) : null} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!mutationsOn || busy} onClick={() => save(false)}>
                {DELIVERY_TEXT.save}
              </Button>
              {delivery !== null ? (
                <Button size="sm" variant="secondary" disabled={!mutationsOn || busy} onClick={() => save(true)}>
                  {DELIVERY_TEXT.clear}
                </Button>
              ) : null}
            </div>
            <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
          </>
        ) : (
          <p className="text-xs text-muted">{DELIVERY_TEXT.locked}</p>
        )}
      </div>
    </Card>
  )
}

// ── بيانات العميل ─────────────────────────────────────────────────────
export function OrderCustomerEditor({
  orderId,
  status,
  current,
  expectedUpdatedAt,
}: {
  orderId: number
  status: OrderStatus
  current: DetailsCurrent
  expectedUpdatedAt: string
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const stampRef = useStamp(expectedUpdatedAt)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(current.customerName)
  const [phone, setPhone] = useState(current.customerPhone)
  const [address, setAddress] = useState(current.address)
  const [notes, setNotes] = useState(current.notes ?? '')
  const [issue, setIssue] = useState<string | null>(null)

  if (!callPanelOpen(status)) return null
  const busy = state === 'saving'

  function reset() {
    setName(current.customerName)
    setPhone(current.customerPhone)
    setAddress(current.address)
    setNotes(current.notes ?? '')
    setIssue(null)
  }

  function save() {
    const result = detailsChanges({ customerName: name, customerPhone: phone, address, notes }, current)
    if (!result.ok) {
      setIssue(result.message)
      return
    }
    setIssue(null)
    void run(() => editOrderDetailsAction(orderId, result.changes, stampRef.current), {
      onSuccess: () => {
        setOpen(false)
        router.refresh()
      },
    })
  }

  if (!open) {
    return (
      <div className="space-y-1.5">
        <Done text={state === 'saved' ? CUSTOMER_TEXT.saved : null} />
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={!mutationsOn}
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          {CUSTOMER_TEXT.edit}
        </Button>
      </div>
    )
  }

  return (
    <Card title={CUSTOMER_TEXT.edit}>
      <div className="space-y-2.5">
        <Field htmlFor="edit-name" label={CUSTOMER_TEXT.name}>
          <input id="edit-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputClasses} disabled={busy} />
        </Field>
        <Field htmlFor="edit-phone" label={CUSTOMER_TEXT.phone} hint={current.hasCoupon ? PHONE_LOCKED_MESSAGE : undefined}>
          <input
            id="edit-phone"
            dir="ltr"
            inputMode="numeric"
            value={phone}
            maxLength={11}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClasses}
            disabled={busy || current.hasCoupon}
          />
        </Field>
        <Field htmlFor="edit-address" label={CUSTOMER_TEXT.address}>
          <textarea id="edit-address" value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} className={textareaClasses} disabled={busy} />
        </Field>
        <Field htmlFor="edit-notes" label={CUSTOMER_TEXT.notes}>
          <textarea id="edit-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={textareaClasses} disabled={busy} />
        </Field>
        <p className="text-xs text-muted">{CUSTOMER_TEXT.lockedFields}</p>
        <Issue text={issue} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!mutationsOn || busy} onClick={save}>
            {busy ? CUSTOMER_TEXT.saving : CUSTOMER_TEXT.save}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
            {CUSTOMER_TEXT.cancel}
          </Button>
        </div>
        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
