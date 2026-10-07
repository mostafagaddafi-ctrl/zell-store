'use client'

import { useEffect, useRef, useState } from 'react'
import { createSupplierAction, updateSupplierAction } from '../../lib/inventoryActions'
import {
  abandonIntent,
  beginIntent,
  canEditPayload,
  editIntent,
  initialIntent,
  isLeaveRisky,
  retryIntent,
  settleIntent,
  type IntentOutcome,
  type IntentState,
} from '../../lib/inventory/intent'
import { INTENT_LABELS } from '../../lib/inventory/labels'
import {
  SUPPLIER_NAME_MAX,
  SUPPLIER_NOTE_MAX,
  emptySupplierForm,
  normalizeSupplierUpdate,
  supplierToForm,
  type InventorySupplier,
  type SupplierFormState,
  type SupplierUpdateInput,
} from '../../lib/inventory/suppliers'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'
import { UnresolvedNotice } from './UnresolvedNotice'

const CLOSE_DIRTY_CONFIRM = 'في تعديلات مش محفوظة. تقفل النموذج من غير حفظ؟'

/**
 * إضافة أو تعديل مورد — كل حفظ «نية كتابة» بمفتاح عملية (lib/inventory/intent.ts):
 *   • المفتاح بيتعمل بعد نجاح التحقق المحلي بس، والبيانات بتتجمّد معاه.
 *   • النتيجة غير المحسومة بتقفل الحقول: إعادة بنفس المفتاح، أو ترك المحاولة ومراجعة الحالة
 *     (النموذج بيتقفل والقايمة بتتقرا من جديد — مفيش فتح للبيانات قبل المصالحة).
 *   • تحذير قفل التاب/التحديث وقت وجود تعديلات أو نتيجة غير محسومة (listener واحد للنموذج المفتوح).
 * التحقق هنا للراحة — السيرفر بيعيده كامل، والداتابيز هي الحكم الأخير.
 */
export function SupplierForm({
  supplier,
  onClose,
  onSaved,
  onReconcile,
}: {
  supplier: InventorySupplier | null
  onClose: () => void
  onSaved: (replayed: boolean) => void
  onReconcile: () => void
}) {
  const mutationsOn = useMutationsEnabled()
  const [form, setForm] = useState<SupplierFormState>(() => (supplier ? supplierToForm(supplier) : emptySupplierForm()))
  const [dirty, setDirty] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [intent, setIntentState] = useState<IntentState<SupplierUpdateInput>>(() => initialIntent())
  const intentRef = useRef(intent)

  function setIntent(next: IntentState<SupplierUpdateInput>) {
    intentRef.current = next
    setIntentState(next)
  }

  const editable = mutationsOn && canEditPayload(intent)
  const risky = isLeaveRisky(intent)

  useEffect(() => {
    if (!dirty && !risky) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, risky])

  function set(patch: Partial<SupplierFormState>) {
    if (!canEditPayload(intentRef.current)) return
    setForm((current) => ({ ...current, ...patch }))
    setDirty(true)
    setLocalError(null)
    setIntent(editIntent(intentRef.current))
  }

  async function send(state: IntentState<SupplierUpdateInput>) {
    if (state.phase !== 'submitting') return
    const { commandId, payload } = state
    let outcome: IntentOutcome
    let replayed = false
    try {
      const result = supplier
        ? await updateSupplierAction(commandId, supplier.supplierId, supplier.version, payload)
        : await createSupplierAction(commandId, { name: payload.name, phone: payload.phone, note: payload.note })
      if (result.ok) {
        outcome = { ok: true }
        replayed = result.data.replayed === true
      } else {
        outcome = { ok: false, code: result.code, message: result.message, resolution: result.resolution }
      }
    } catch {
      outcome = { thrown: true }
    }
    const next = settleIntent(intentRef.current, commandId, outcome)
    setIntent(next)
    if (next.phase === 'done') {
      setDirty(false)
      onSaved(replayed)
    }
  }

  function submit() {
    const current = intentRef.current
    if (!canEditPayload(current)) return
    const parsed = normalizeSupplierUpdate({
      name: form.name,
      phone: form.phone,
      note: form.note,
      isActive: supplier ? form.isActive : true,
    })
    if (!parsed.ok) {
      // التحقق المحلي الفاشل مابيستهلكش مفتاح عملية
      setLocalError(parsed.message)
      return
    }
    const next = beginIntent(current, parsed.value, crypto.randomUUID())
    if (next === null) return
    setIntent(next)
    void send(next)
  }

  function retry() {
    const next = retryIntent(intentRef.current)
    if (next === null) return
    setIntent(next)
    void send(next)
  }

  function abandon() {
    const next = abandonIntent(intentRef.current)
    if (next === null) return
    setIntent(next)
    setDirty(false)
    onReconcile()
  }

  function reconcile() {
    setDirty(false)
    onReconcile()
  }

  function close() {
    if (risky) return
    if (dirty && !window.confirm(CLOSE_DIRTY_CONFIRM)) return
    setDirty(false)
    onClose()
  }

  const failure = intent.phase === 'editing' ? intent.failure : null

  return (
    <Card
      title={supplier ? 'تعديل المورد: ' + supplier.name : 'مورد جديد'}
      actions={
        <Button variant="ghost" size="sm" onClick={close} disabled={risky}>
          {INTENT_LABELS.close}
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
          <Field htmlFor="supplier-name" label="اسم المورد" hint={'لحد ' + String(SUPPLIER_NAME_MAX) + ' حرف'}>
            <input
              id="supplier-name"
              autoComplete="off"
              maxLength={SUPPLIER_NAME_MAX + 20}
              value={form.name}
              disabled={!editable}
              onChange={(event) => set({ name: event.target.value })}
              className={inputClasses}
            />
          </Field>
          <Field htmlFor="supplier-phone" label="التليفون" hint="اختياري · من 6 لـ 15 رقم، وممكن يبدأ بـ +">
            <input
              id="supplier-phone"
              dir="ltr"
              inputMode="tel"
              autoComplete="off"
              maxLength={30}
              value={form.phone}
              disabled={!editable}
              onChange={(event) => set({ phone: event.target.value })}
              className={inputClasses}
            />
          </Field>
        </div>

        <Field htmlFor="supplier-note" label="ملاحظة" hint={'اختياري · لحد ' + String(SUPPLIER_NOTE_MAX) + ' حرف'}>
          <textarea
            id="supplier-note"
            maxLength={SUPPLIER_NOTE_MAX + 50}
            value={form.note}
            disabled={!editable}
            onChange={(event) => set({ note: event.target.value })}
            className={textareaClasses}
          />
        </Field>

        {supplier ? (
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={form.isActive}
              disabled={!editable}
              onChange={(event) => set({ isActive: event.target.checked })}
            />
            المورد نشط
            <span className="text-xs text-muted">(الموقوف مابيظهرش في اختيار المورد للفواتير الجديدة)</span>
          </label>
        ) : null}

        {localError ? (
          <p role="alert" className="text-xs font-semibold text-danger">
            {localError}
          </p>
        ) : null}

        {failure ? (
          <FailureBanner
            failure={failure}
            onRetry={failure.code === 'UNAUTHENTICATED' ? submit : undefined}
            onDiscardAndRefresh={failure.code === 'CONFLICT' ? reconcile : undefined}
          />
        ) : null}

        {intent.phase === 'unresolved' ? (
          <UnresolvedNotice
            message={intent.message}
            hard={intent.hard}
            attempt={intent.attempt}
            onRetry={retry}
            onAbandon={abandon}
          />
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" disabled={!editable}>
            {intent.phase === 'submitting' ? 'بيحفظ…' : supplier ? 'حفظ التعديل' : 'إضافة المورد'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
