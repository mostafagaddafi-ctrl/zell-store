'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmationFeePiastres } from '@zell/core'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { formatPiastres } from '../../lib/format'
import { savePaymentSettingsAction } from '../../lib/paymentActions'
import {
  FEE_METHODS,
  FEE_METHOD_LABELS,
  FEE_POLICY_MAX,
  FEE_SCOPES,
  FEE_SCOPE_LABELS,
  PAYMENT_NUMBERS_MAX,
  TEMPLATE_VARIABLES,
  WHATSAPP_TEMPLATE_MAX,
  bpToPercentLabel,
  feeConfigLine,
  feeConfigOf,
  feeFormOf,
  type FeeForm,
  type FeeMethod,
  type FeeScope,
  type PaymentSettings,
} from '../../lib/orders/payments'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * 0021-A P2 — إعدادات الدفع للمالك: رسوم التأكيد (مقفولة افتراضيًا ومن غير أرقام) · البيع الآجل · أرقام الدفع · السياسة ·
 * قالب واتساب. النسبة بتتكتب وبتتعرض نسبة مئوية (مثلًا 2.5%)، والتخزين بوحدة 0.01%. التحقق النهائي في zell_payment_save_settings.
 */
const EXAMPLE_TOTAL = 100000

export function PaymentSettingsForm({ settings }: { settings: PaymentSettings }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const [form, setForm] = useState<FeeForm>(() => feeFormOf(settings.fee))
  const [credit, setCredit] = useState(settings.creditEnabled)
  const [numbers, setNumbers] = useState(settings.paymentNumbers ?? '')
  const [policy, setPolicy] = useState(settings.feePolicy ?? '')
  const [template, setTemplate] = useState(settings.whatsappTemplate ?? '')
  const [issue, setIssue] = useState<string | null>(null)
  const busy = state === 'saving'
  const disabled = !mutationsOn || busy
  const set = (patch: Partial<FeeForm>) => setForm((current) => ({ ...current, ...patch }))

  const draft = feeConfigOf(form)
  const example = draft.ok && draft.config.enabled
    ? confirmationFeePiastres(draft.config, { totalPiastres: EXAMPLE_TOTAL, shippingPiastres: 5000, madeToMeasure: true, installation: true })
    : null

  function save() {
    const result = feeConfigOf(form)
    if (!result.ok) {
      setIssue(result.message)
      return
    }
    setIssue(null)
    const input = {
      expectedUpdatedAt: settings.updatedAt,
      fee: result.config,
      creditEnabled: credit,
      paymentNumbers: numbers,
      feePolicy: policy,
      whatsappTemplate: template,
    }
    void run(() => savePaymentSettingsAction(input), { onSuccess: () => router.refresh() })
  }

  return (
    <Card title="رسوم التأكيد والدفع">
      <div className="space-y-3">
        <p className="text-xs text-muted">{'الحالي: ' + feeConfigLine(settings.fee)}</p>

        <label className="flex items-center gap-2 text-sm font-semibold text-fg">
          <input type="checkbox" checked={form.enabled} onChange={(event) => set({ enabled: event.target.checked })} disabled={disabled} />
          تفعيل رسوم تأكيد الطلب (مقدم من الإجمالي نفسه، وليس خصمًا)
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <Field htmlFor="fee-scope" label="الطلبات اللي عليها رسوم">
            <select id="fee-scope" value={form.scope} onChange={(event) => set({ scope: event.target.value as FeeScope })} className={inputClasses} disabled={disabled}>
              {FEE_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {FEE_SCOPE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="fee-method" label="طريقة حساب الرسوم">
            <select id="fee-method" value={form.method} onChange={(event) => set({ method: event.target.value as FeeMethod })} className={inputClasses} disabled={disabled}>
              {FEE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {FEE_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {form.method === 'percent' ? (
          <Field htmlFor="fee-percent" label="النسبة (%)" hint="نسبة مئوية من إجمالي الطلب، مثل 10 أو 2.5 (حتى رقمين عشريين). ويُقرَّب المقدم إلى أقرب جنيه للأعلى.">
            <input id="fee-percent" inputMode="decimal" dir="ltr" value={form.percent} onChange={(event) => set({ percent: event.target.value })} className={inputClasses} disabled={disabled} />
          </Field>
        ) : null}
        {form.method === 'fixed' ? (
          <Field htmlFor="fee-fixed" label="المبلغ الثابت (جنيه)">
            <input id="fee-fixed" inputMode="decimal" dir="ltr" value={form.fixedPounds} onChange={(event) => set({ fixedPounds: event.target.value })} className={inputClasses} disabled={disabled} />
          </Field>
        ) : null}
        {form.method === 'shipping' ? (
          <Field htmlFor="fee-fallback" label="قيمة بديلة لو الشحن مجاني (جنيه)" hint="حتى لا يكون المقدم صفرًا دون قصد.">
            <input id="fee-fallback" inputMode="decimal" dir="ltr" value={form.fallbackPounds} onChange={(event) => set({ fallbackPounds: event.target.value })} className={inputClasses} disabled={disabled} />
          </Field>
        ) : null}
        {form.scope === 'above_amount' ? (
          <Field htmlFor="fee-threshold" label="من إجمالي (جنيه) وأكتر">
            <input id="fee-threshold" inputMode="decimal" dir="ltr" value={form.thresholdPounds} onChange={(event) => set({ thresholdPounds: event.target.value })} className={inputClasses} disabled={disabled} />
          </Field>
        ) : null}

        {draft.ok && draft.config.enabled && draft.config.method === 'percent' && typeof draft.config.percent_bp === 'number' ? (
          <p className="text-xs text-fg">{'النسبة اللي هتتحفظ: ' + bpToPercentLabel(draft.config.percent_bp)}</p>
        ) : null}
        {example !== null ? (
          <p className="text-xs text-muted">{'مثال: طلب إجماليه ' + formatPiastres(EXAMPLE_TOTAL) + ' (بالمقاس وفيه تركيب، شحن 50 جنيه) ← مقدم ' + formatPiastres(example)}</p>
        ) : null}

        <label className="flex items-center gap-2 text-sm font-semibold text-fg">
          <input type="checkbox" checked={credit} onChange={(event) => setCredit(event.target.checked)} disabled={disabled} />
          السماح بالتسليم الآجل (الباقي يفضل على العميل باختيار صريح وقت التسليم)
        </label>

        <Field htmlFor="pay-numbers" label="أرقام الدفع (المحافظ والحساب البنكي)">
          <textarea id="pay-numbers" value={numbers} maxLength={PAYMENT_NUMBERS_MAX} onChange={(event) => setNumbers(event.target.value)} className={textareaClasses} disabled={disabled} />
        </Field>
        <Field htmlFor="pay-policy" label="سياسة رسوم التأكيد (تظهر للعميل في صفحة إتمام الطلب)">
          <textarea id="pay-policy" value={policy} maxLength={FEE_POLICY_MAX} onChange={(event) => setPolicy(event.target.value)} className={textareaClasses} disabled={disabled} />
        </Field>
        <Field htmlFor="pay-template" label="قالب رسالة واتساب" hint={'المتغيرات: ' + TEMPLATE_VARIABLES.join(' ')}>
          <textarea id="pay-template" value={template} maxLength={WHATSAPP_TEMPLATE_MAX} onChange={(event) => setTemplate(event.target.value)} className={textareaClasses} disabled={disabled} />
        </Field>

        {issue !== null ? <p className="text-xs font-medium text-danger">{issue}</p> : null}
        {state === 'saved' ? <p role="status" className="text-xs text-ok">اتحفظ.</p> : null}
        <Button size="sm" disabled={disabled} onClick={save}>
          {busy ? 'جارِ الحفظ…' : 'حفظ'}
        </Button>
        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
