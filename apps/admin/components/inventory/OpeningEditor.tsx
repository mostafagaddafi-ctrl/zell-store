'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Save, Send, Trash2 } from 'lucide-react'
import {
  createOpeningAction,
  discardOpeningAction,
  postOpeningAction,
  previewOpeningAction,
  updateOpeningAction,
} from '../../lib/inventoryActions'
import { useInventoryIntent } from '../../lib/client/useInventoryIntent'
import type { CatalogProduct } from '../../lib/inventory/catalog'
import { DOC_ACTION_LABELS } from '../../lib/inventory/labels'
import {
  OPENING_LIMITS,
  buildOpeningPayload,
  emptyOpeningForm,
  openingPayloadToForm,
  openingPostIssues,
  openingTotals,
  type LineEstimate,
  type OpeningDocPayload,
  type OpeningFormState,
} from '../../lib/inventory/openingForm'
import type { OpeningHeader, OpeningPreview, OpeningWriteResult } from '../../lib/inventory/openings'
import { PURCHASE_LIMITS, type LineForm } from '../../lib/inventory/purchaseForm'
import type { InventoryLocationOption } from '../../lib/inventory/purchases'
import { canConfirm, createWriteLock, type WriteLock } from '../../lib/inventory/writeLock'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'
import { OpeningPreviewPanel, OpeningTotalsList } from './OpeningPanels'
import { PurchaseLinesEditor } from './PurchaseLinesEditor'
import { ReasonDialog } from './ReasonDialog'
import { UnresolvedNotice } from './UnresolvedNotice'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

type Draft = { header: OpeningHeader; payload: OpeningDocPayload }
type DocRef = { docId: number; version: number }
type DiscardPayload = DocRef & { reason: string }

const REPLAYED_MESSAGE = 'العملية دي كانت اتنفذت قبل كده، واتعرضت نتيجتها من غير تكرار.'
const PREVIEW_FAILED = 'المعاينة فشلت. جرّب تاني.'

/**
 * رصيد أول المدة جديد أو تعديل مسودة — نفس قواعد فاتورة الشراء بالظبط:
 *   • كل عملية (حفظ، ترحيل، استبعاد) نية مستقلة بمفتاح مستقل، والـ3 بياخدوا نفس WriteLock
 *     (حجز متزامن قبل البدء) — ضغطتين في نفس الـtick مابيبدأوش غير عملية واحدة.
 *   • كل تأكيد بيعيد فحص القيم الحالية (gateRef + القفل) وقت الضغط، والحوارات busy أثناء العملية.
 *   • الترحيل بيرحّل المسودة المحفوظة بنسختها (مقفول مع تعديلات مش محفوظة).
 *   • حماية المغادرة من UnsavedChangesGuard.
 * الفرق: مفيش مورد ولا مصاريف ولا خصم، وكل بند ليه «التكلفة تقديرية» + ملاحظة إجبارية معاها.
 */
export function OpeningEditor({
  draft,
  catalog,
  locations,
  today,
}: {
  draft: Draft | null
  catalog: CatalogProduct[]
  locations: InventoryLocationOption[]
  today: string
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const keyRef = useRef(0)
  const newKey = () => {
    keyRef.current += 1
    return 'o' + String(keyRef.current)
  }
  const catalogMap = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog])
  const defaultLocation = locations.find((location) => location.isDefault) ?? locations[0]

  const [form, setForm] = useState<OpeningFormState>(() =>
    draft
      ? openingPayloadToForm(draft.payload, newKey)
      : emptyOpeningForm({ locationId: defaultLocation ? defaultLocation.locationId : null, today }),
  )
  const [dirty, setDirty] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<OpeningPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirmPost, setConfirmPost] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [reconciling, startReconcile] = useTransition()
  const lockRef = useRef<WriteLock | null>(null)
  if (lockRef.current === null) lockRef.current = createWriteLock()
  const lock = lockRef.current

  function reconcile() {
    setDirty(false)
    startReconcile(() => router.refresh())
  }

  const save = useInventoryIntent<OpeningDocPayload, OpeningWriteResult>(
    (commandId, payload) =>
      draft
        ? updateOpeningAction(commandId, draft.header.docId, draft.header.version, payload)
        : createOpeningAction(commandId, payload),
    {
      onDone: (result) => {
        setDirty(false)
        if (!draft) {
          router.replace('/inventory/openings/' + String(result.docId))
          return
        }
        setNotice(result.replayed === true ? REPLAYED_MESSAGE : 'اتحفظت المسودة.')
        startReconcile(() => router.refresh())
      },
      onAbandon: () => {
        setDirty(false)
        if (!draft) {
          router.push('/inventory/openings?status=draft')
          return
        }
        startReconcile(() => router.refresh())
      },
    },
    { lock, owner: 'save' },
  )

  const post = useInventoryIntent<DocRef, OpeningWriteResult>(
    (commandId, ref) => postOpeningAction(commandId, ref.docId, ref.version),
    {
      onDone: (result) => {
        setNotice(result.replayed === true ? REPLAYED_MESSAGE : 'اترحّل رصيد أول المدة.')
        startReconcile(() => router.refresh())
      },
      onAbandon: reconcile,
    },
    { lock, owner: 'post' },
  )

  const discard = useInventoryIntent<DiscardPayload, OpeningWriteResult>(
    (commandId, ref) => discardOpeningAction(commandId, ref.docId, ref.version, ref.reason),
    {
      onDone: (result) => {
        setNotice(result.replayed === true ? REPLAYED_MESSAGE : 'اتستبعدت المسودة.')
        startReconcile(() => router.refresh())
      },
      onAbandon: reconcile,
    },
    { lock, owner: 'discard' },
  )

  const wasReconciling = useRef(false)
  useEffect(() => {
    if (reconciling) {
      wasReconciling.current = true
      return
    }
    if (!wasReconciling.current) return
    wasReconciling.current = false
    for (const intent of [save, post, discard]) intent.afterReconcile()
  }, [reconciling])

  const intents = [save, post, discard]
  const locked = reconciling || intents.some((intent) => intent.intent.phase !== 'editing')
  const editable = mutationsOn && !locked
  const guardActive = dirty || intents.some((intent) => intent.risky)

  const built = useMemo(() => buildOpeningPayload(form, catalogMap, today), [form, catalogMap, today])
  const liveTotals = built.ok ? openingTotals(built.value) : null
  const savedIssues = draft ? openingPostIssues(draft.payload) : []

  function update(patch: Partial<OpeningFormState>) {
    if (locked) return
    setForm((current) => ({ ...current, ...patch }))
    setDirty(true)
    setLocalError(null)
    setNotice(null)
    setPreview(null)
    setPreviewError(null)
    save.edit()
  }

  function setEstimate(key: string, estimate: LineEstimate) {
    update({ estimates: { ...form.estimates, [key]: estimate } })
  }

  function submitSave() {
    if (!editable) return
    if (!built.ok) {
      setLocalError(built.message)
      return
    }
    save.begin(built.value)
  }

  async function runPreview() {
    if (!built.ok) {
      setLocalError(built.message)
      return
    }
    setPreviewing(true)
    setPreview(null)
    setPreviewError(null)
    try {
      const result = await previewOpeningAction(built.value)
      if (result.ok) setPreview(result.data)
      else setPreviewError(result.code === 'INTERNAL' ? PREVIEW_FAILED : result.message)
    } catch {
      setPreviewError(PREVIEW_FAILED)
    } finally {
      setPreviewing(false)
    }
  }

  const locationOptions = locations.map((l) => ({ id: l.locationId, label: l.name }))
  if (draft && !locations.some((l) => l.locationId === draft.header.locationId)) {
    locationOptions.push({ id: draft.header.locationId, label: draft.header.locationName + ' (موقوف)' })
  }

  const postBlocked = !draft
    ? 'احفظ المسودة الأول.'
    : dirty
      ? 'احفظ التعديلات الأول — الترحيل بيرحّل المسودة المحفوظة.'
      : savedIssues.length > 0
        ? savedIssues.join(' ')
        : null

  const gateRef = useRef({ mutationsOn, reconciling, postBlocked })
  gateRef.current = { mutationsOn, reconciling, postBlocked }

  function confirmPostNow(ref: DocRef) {
    setConfirmPost(false)
    const gate = gateRef.current
    if (!canConfirm({ mutationsOn: gate.mutationsOn, reconciling: gate.reconciling, lockHolder: lock.holder(), blockedReason: gate.postBlocked })) return
    post.begin(ref)
  }

  function confirmDiscardNow(payload: DiscardPayload) {
    setDiscardOpen(false)
    const gate = gateRef.current
    if (!canConfirm({ mutationsOn: gate.mutationsOn, reconciling: gate.reconciling, lockHolder: lock.holder(), blockedReason: null })) return
    discard.begin(payload)
  }

  function renderEstimate(line: LineForm) {
    const estimate = form.estimates[line.key] ?? { estimated: false, note: '' }
    return (
      <div className="space-y-2 rounded border border-dashed border-border p-2.5">
        <label className="flex items-center gap-2 text-xs font-semibold text-fg">
          <input
            type="checkbox"
            checked={estimate.estimated}
            disabled={!editable}
            onChange={(event) => setEstimate(line.key, { ...estimate, estimated: event.target.checked })}
          />
          التكلفة تقديرية (مش من فاتورة فعلية)
        </label>
        {estimate.estimated ? (
          <Field htmlFor={'estimate-' + line.key} label="ملاحظة التقدير" hint="إجبارية مع التقدير · من 3 لـ 200 حرف · البند اللي تكلفته صفر مايبقاش تقديري">
            <input
              id={'estimate-' + line.key}
              value={estimate.note}
              maxLength={OPENING_LIMITS.estimateNoteMax + 20}
              disabled={!editable}
              onChange={(event) => setEstimate(line.key, { ...estimate, note: event.target.value })}
              className={inputClasses}
            />
          </Field>
        ) : null}
      </div>
    )
  }

  const saveFailure = save.intent.phase === 'editing' ? save.intent.failure : null
  const postFailure = post.intent.phase === 'editing' ? post.intent.failure : null
  const discardFailure = discard.intent.phase === 'editing' ? discard.intent.failure : null

  return (
    <div className="space-y-4">
      <UnsavedChangesGuard active={guardActive} />

      <Card title={draft ? 'مسودة ' + draft.header.docNo : 'رصيد أول مدة جديد'}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="opening-location" label="المخزن">
            <select
              id="opening-location"
              value={form.locationId}
              disabled={!editable}
              onChange={(event) => update({ locationId: event.target.value })}
              className={inputClasses}
            >
              <option value="">اختار المخزن</option>
              {locationOptions.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="opening-date" label="تاريخ الرصيد" hint="مش في المستقبل (بتوقيت القاهرة)">
            <input
              id="opening-date"
              type="date"
              dir="ltr"
              max={today}
              value={form.asOfDate}
              disabled={!editable}
              onChange={(event) => update({ asOfDate: event.target.value })}
              className={inputClasses}
            />
          </Field>
        </div>
        <Field htmlFor="opening-note" label="ملاحظة" hint={'اختياري · لحد ' + String(PURCHASE_LIMITS.note) + ' حرف'} className="mt-3">
          <textarea
            id="opening-note"
            value={form.note}
            maxLength={PURCHASE_LIMITS.note + 50}
            disabled={!editable}
            onChange={(event) => update({ note: event.target.value })}
            className={textareaClasses}
          />
        </Field>
      </Card>

      <Card title="البضاعة الموجودة">
        <PurchaseLinesEditor
          lines={form.lines}
          onChange={(lines) => update({ lines })}
          catalog={catalog}
          disabled={!editable}
          newKey={newKey}
          renderLineExtra={renderEstimate}
        />
      </Card>

      <Card
        title="الإجماليات والمعاينة"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void runPreview()} disabled={previewing || locked}>
            <Eye className="h-3.5 w-3.5" />
            {previewing ? 'بيحسب…' : 'معاينة التكلفة'}
          </Button>
        }
      >
        <div className="space-y-3">
          {liveTotals ? (
            <>
              <OpeningTotalsList itemsTotalPiastres={liveTotals.itemsTotalPiastres} estimatedTotalPiastres={liveTotals.estimatedTotalPiastres} />
              <p className="text-xs text-muted">{liveTotals.lotCount} دفعة (كل لفّة دفعة، وكل بند قطع دفعة).</p>
            </>
          ) : (
            <p className="text-xs text-muted">الإجماليات بتظهر لما البيانات تبقى كاملة وصحيحة.</p>
          )}
          {previewError ? (
            <p role="alert" className="text-xs font-semibold text-danger">
              {previewError}
            </p>
          ) : null}
          {preview ? <OpeningPreviewPanel preview={preview} /> : null}
        </div>
      </Card>

      {localError ? (
        <p role="alert" className="text-xs font-semibold text-danger">
          {localError}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border-s-2 border-ok bg-ok/5 px-3 py-2 text-xs text-fg">
          {notice}
        </p>
      ) : null}

      {saveFailure ? (
        <FailureBanner
          failure={saveFailure}
          onRetry={saveFailure.code === 'UNAUTHENTICATED' ? submitSave : undefined}
          onDiscardAndRefresh={saveFailure.code === 'CONFLICT' ? reconcile : undefined}
        />
      ) : null}
      {postFailure ? (
        <FailureBanner failure={postFailure} onDiscardAndRefresh={postFailure.code === 'CONFLICT' ? reconcile : undefined} />
      ) : null}
      {discardFailure ? (
        <FailureBanner failure={discardFailure} onDiscardAndRefresh={discardFailure.code === 'CONFLICT' ? reconcile : undefined} />
      ) : null}

      {intents.map((intent, index) =>
        intent.intent.phase === 'unresolved' ? (
          <UnresolvedNotice
            key={index}
            message={intent.intent.message}
            hard={intent.intent.hard}
            attempt={intent.intent.attempt}
            onRetry={intent.retry}
            onAbandon={intent.abandon}
          />
        ) : null,
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button onClick={submitSave} disabled={!editable}>
          <Save className="h-4 w-4" />
          {save.intent.phase === 'submitting' ? 'بيحفظ…' : draft ? 'حفظ المسودة' : 'حفظ كمسودة'}
        </Button>
        {draft ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmPost(true)} disabled={!editable || postBlocked !== null}>
              <Send className="h-4 w-4" />
              {post.intent.phase === 'submitting' ? 'بيرحّل…' : DOC_ACTION_LABELS.post}
            </Button>
            <Button variant="danger" onClick={() => setDiscardOpen(true)} disabled={!editable}>
              <Trash2 className="h-4 w-4" />
              {DOC_ACTION_LABELS.discard}
            </Button>
          </>
        ) : null}
        {!mutationsOn ? <span className="text-xs text-muted">التعديلات موقوفة دلوقتي (علم الجاهزية).</span> : null}
      </div>
      {draft && postBlocked !== null && !locked ? <p className="text-xs text-muted">الترحيل: {postBlocked}</p> : null}

      {draft ? (
        <>
          <ConfirmDialog
            open={confirmPost}
            title={'ترحيل ' + draft.header.docNo + '؟'}
            message="بعد الترحيل المستند بيتقفل، وبتتعمل دفعة لكل لفّة ولكل بند قطع بالتكلفة (والتقديري بيفضل متعلّم إنه تقديري). مفيش تعديل بعد كده — الإبطال بس، وبسبب."
            confirmLabel={DOC_ACTION_LABELS.post}
            busy={locked}
            onCancel={() => setConfirmPost(false)}
            onConfirm={() => confirmPostNow({ docId: draft.header.docId, version: draft.header.version })}
          />
          <ReasonDialog
            open={discardOpen}
            kind="discard"
            title={DOC_ACTION_LABELS.discard}
            message="المسودة هتفضل ظاهرة في القايمة بحالة «مستبعَد (مسودة)»، ومش هتتعدل ولا تترحّل بعد كده."
            confirmLabel={DOC_ACTION_LABELS.discard}
            busy={locked}
            onCancel={() => setDiscardOpen(false)}
            onConfirm={(reason) => confirmDiscardNow({ docId: draft.header.docId, version: draft.header.version, reason })}
          />
        </>
      ) : null}
    </div>
  )
}
