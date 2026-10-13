'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { formatPiastres } from '../../lib/format'
import { deliverOnCreditAction, deliverWithCollectionAction, recordPaymentAction, refundPaymentAction } from '../../lib/paymentActions'
import {
  OTHER_METHOD,
  PAYMENT_NOTE_MAX,
  PAYMENT_PURPOSES,
  PAYMENT_REFERENCE_MAX,
  PAYMENT_TEXT,
  METHOD_NAME_MAX,
  PURPOSE_LABELS,
  piastresToPoundsInput,
  poundsInputToPiastres,
  suggestedAmount,
  suggestedPurpose,
  type PaymentMethod,
  type PaymentPurpose,
  type PaymentSummary,
} from '../../lib/orders/payments'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Field, inputClasses, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * 0021-A P2 — فورمات الدفع في صفحة الطلب: تسجيل دفعة · رد (المالك) · التسليم مع التحصيل أو الآجل الصريح.
 * كل نية كتابة ليها command_id ثابت (بيتعمل مرة ويتعاد مع «إعادة المحاولة»)، فالداتابيز مابتسجّلش الفلوس مرتين.
 * القرار النهائي (المبالغ والحالة والمقدم والباقي) في دوال zell_payment_* .
 */

function newCommandId(): string {
  return crypto.randomUUID()
}

function useCommand() {
  const ref = useRef<string | null>(null)
  return {
    current(): string {
      if (ref.current === null) ref.current = newCommandId()
      return ref.current
    },
    reset(): void {
      ref.current = null
    },
  }
}

function MethodPicker({
  id,
  methods,
  value,
  other,
  onChange,
  onOther,
  disabled,
}: {
  id: string
  methods: PaymentMethod[]
  value: string
  other: string
  onChange: (value: string) => void
  onOther: (value: string) => void
  disabled: boolean
}) {
  const active = methods.filter((m) => !m.isArchived)
  return (
    <>
      <Field htmlFor={id} label={PAYMENT_TEXT.method}>
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={inputClasses} disabled={disabled}>
          <option value="">—</option>
          {active.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.name}
            </option>
          ))}
          <option value={OTHER_METHOD}>{PAYMENT_TEXT.otherMethod}</option>
        </select>
      </Field>
      {value === OTHER_METHOD ? (
        <Field htmlFor={id + '-other'} label={PAYMENT_TEXT.otherName}>
          <input id={id + '-other'} value={other} maxLength={METHOD_NAME_MAX} onChange={(event) => onOther(event.target.value)} className={inputClasses} disabled={disabled} />
        </Field>
      ) : null}
    </>
  )
}

function methodChoice(value: string): number | null {
  return value === '' || value === OTHER_METHOD ? null : Number(value)
}

// ── تسجيل دفعة / رد ────────────────────────────────────────────────────
export function PaymentEntryForm({
  mode,
  summary,
  methods,
}: {
  mode: 'payment' | 'refund'
  summary: PaymentSummary
  methods: PaymentMethod[]
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const command = useCommand()
  const initialPurpose: PaymentPurpose = mode === 'payment' ? suggestedPurpose(summary) : 'balance'
  const [purpose, setPurpose] = useState<PaymentPurpose>(initialPurpose)
  const [amount, setAmount] = useState(mode === 'payment' ? piastresToPoundsInput(suggestedAmount(summary, initialPurpose)) : '')
  const [method, setMethod] = useState('')
  const [other, setOther] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [issue, setIssue] = useState<string | null>(null)
  const busy = state === 'saving'
  const prefix = 'pay-' + mode
  const max = mode === 'payment' ? summary.remainingPiastres : summary.paidPiastres

  function submit() {
    const piastres = poundsInputToPiastres(amount, max)
    if (piastres === null) {
      setIssue(mode === 'payment' ? 'اكتب مبلغ أكبر من صفر ولحد ' + formatPiastres(max) + '.' : 'اكتب مبلغ أكبر من صفر ولحد المدفوع ' + formatPiastres(max) + '.')
      return
    }
    if (method === '' || (method === OTHER_METHOD && other.trim() === '')) {
      setIssue('اختار طريقة الدفع.')
      return
    }
    if (mode === 'refund' && !window.confirm(PAYMENT_TEXT.refundConfirm)) return
    setIssue(null)
    const input = {
      orderId: summary.orderId,
      commandId: command.current(),
      expectedUpdatedAt: summary.updatedAt,
      amountPiastres: piastres,
      purpose,
      methodId: methodChoice(method),
      methodOther: method === OTHER_METHOD ? other : '',
      reference,
      note,
    }
    void run(() => (mode === 'payment' ? recordPaymentAction(input) : refundPaymentAction(input)), {
      onSuccess: () => {
        command.reset()
        setReference('')
        setNote('')
        router.refresh()
      },
    })
  }

  const disabled = !mutationsOn || busy
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Field htmlFor={prefix + '-amount'} label={PAYMENT_TEXT.amount}>
          <input id={prefix + '-amount'} inputMode="decimal" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClasses} disabled={disabled} />
        </Field>
        <Field htmlFor={prefix + '-purpose'} label={PAYMENT_TEXT.purpose}>
          <select id={prefix + '-purpose'} value={purpose} onChange={(event) => setPurpose(event.target.value as PaymentPurpose)} className={inputClasses} disabled={disabled}>
            {PAYMENT_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <MethodPicker id={prefix + '-method'} methods={methods} value={method} other={other} onChange={setMethod} onOther={setOther} disabled={disabled} />
      <Field htmlFor={prefix + '-ref'} label={PAYMENT_TEXT.reference}>
        <input id={prefix + '-ref'} value={reference} maxLength={PAYMENT_REFERENCE_MAX} onChange={(event) => setReference(event.target.value)} className={inputClasses} disabled={disabled} />
      </Field>
      <Field htmlFor={prefix + '-note'} label={PAYMENT_TEXT.note}>
        <textarea id={prefix + '-note'} value={note} maxLength={PAYMENT_NOTE_MAX} onChange={(event) => setNote(event.target.value)} className={textareaClasses} disabled={disabled} />
      </Field>
      {issue !== null ? <p className="text-xs font-medium text-danger">{issue}</p> : null}
      {state === 'saved' ? <p role="status" className="text-xs text-ok">{PAYMENT_TEXT.saved}</p> : null}
      <Button size="sm" variant={mode === 'refund' ? 'danger' : 'primary'} disabled={disabled} onClick={submit}>
        {busy ? PAYMENT_TEXT.saving : PAYMENT_TEXT.submit}
      </Button>
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
    </div>
  )
}

// ── التسليم مع التحصيل / الآجل الصريح ──────────────────────────────────
export function DeliverForm({
  summary,
  methods,
  creditEnabled,
}: {
  summary: PaymentSummary
  methods: PaymentMethod[]
  creditEnabled: boolean
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const command = useCommand()
  const [method, setMethod] = useState('')
  const [other, setOther] = useState('')
  const [reference, setReference] = useState('')
  const [issue, setIssue] = useState<string | null>(null)
  const busy = state === 'saving'
  const disabled = !mutationsOn || busy
  const remaining = summary.remainingPiastres

  function base() {
    return { orderId: summary.orderId, commandId: command.current(), expectedUpdatedAt: summary.updatedAt }
  }

  function deliverPaid() {
    if (remaining > 0 && (method === '' || (method === OTHER_METHOD && other.trim() === ''))) {
      setIssue('اختار طريقة تحصيل الباقي.')
      return
    }
    if (!window.confirm(PAYMENT_TEXT.deliverConfirm)) return
    setIssue(null)
    const input = remaining > 0
      ? { ...base(), amountPiastres: remaining, methodId: methodChoice(method), methodOther: method === OTHER_METHOD ? other : '', reference, onCredit: false }
      : { ...base(), amountPiastres: null, methodId: null, methodOther: '', reference: '', onCredit: false }
    void run(() => deliverWithCollectionAction(input), { onSuccess: () => { command.reset(); router.refresh() } })
  }

  function deliverCredit() {
    if (!window.confirm(PAYMENT_TEXT.deliverCreditConfirm)) return
    setIssue(null)
    const input = { ...base(), amountPiastres: null, methodId: null, methodOther: '', reference: '', onCredit: true }
    void run(() => deliverOnCreditAction(input), { onSuccess: () => { command.reset(); router.refresh() } })
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted">{PAYMENT_TEXT.deliverHint}</p>
      {remaining > 0 ? (
        <>
          <p className="text-sm font-semibold text-fg">{'تحصيل الباقي: ' + formatPiastres(remaining)}</p>
          <MethodPicker id="deliver-method" methods={methods} value={method} other={other} onChange={setMethod} onOther={setOther} disabled={disabled} />
          <Field htmlFor="deliver-ref" label={PAYMENT_TEXT.reference}>
            <input id="deliver-ref" value={reference} maxLength={PAYMENT_REFERENCE_MAX} onChange={(event) => setReference(event.target.value)} className={inputClasses} disabled={disabled} />
          </Field>
        </>
      ) : null}
      {issue !== null ? <p className="text-xs font-medium text-danger">{issue}</p> : null}
      {state === 'saved' ? <p role="status" className="text-xs text-ok">{PAYMENT_TEXT.delivered}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={deliverPaid}>
          {remaining > 0 ? 'تحصيل ' + formatPiastres(remaining) + ' وتسليم' : 'تسجيل التسليم'}
        </Button>
        {creditEnabled && remaining > 0 ? (
          <Button size="sm" variant="secondary" disabled={disabled} onClick={deliverCredit}>
            {PAYMENT_TEXT.deliverCredit}
          </Button>
        ) : null}
      </div>
      {creditEnabled && remaining > 0 ? <p className="text-xs text-muted">{PAYMENT_TEXT.deliverCreditHint}</p> : null}
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
    </div>
  )
}
