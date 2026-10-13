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
import { usePreview } from '../../lib/client/usePreview'
import type { CatalogProduct } from '../../lib/inventory/catalog'
import { DOC_ACTION_LABELS } from '../../lib/inventory/labels'
import { formatPiastresExact } from '../../lib/inventory/money'
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
import type { OpeningHeader, OpeningWriteResult } from '../../lib/inventory/openings'
import { groupLotsByLine } from '../../lib/inventory/pricing'
import { payloadFingerprint } from '../../lib/inventory/previewTracker'
import { PURCHASE_LIMITS, type LineForm } from '../../lib/inventory/purchaseForm'
import type { InventoryLocationOption } from '../../lib/inventory/purchases'
import { canConfirm, createWriteLock, type WriteLock } from '../../lib/inventory/writeLock'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'
import { InventoryActionBar } from './InventoryActionBar'
import { PurchaseLinesEditor } from './PurchaseLinesEditor'
import { ReasonDialog } from './ReasonDialog'
import { UnresolvedNotice } from './UnresolvedNotice'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

type Draft = { header: OpeningHeader; payload: OpeningDocPayload }
type DocRef = { docId: number; version: number }
type DiscardPayload = DocRef & { reason: string }

const REPLAYED_MESSAGE = 'العملية دي كانت اتنفذت قبل كده، واتعرضت نتيجتها من غير تكرار.'
const money = (piastres: number | undefined) => (piastres === undefined ? '—' : formatPiastresExact(piastres))

/**
 * رصيد أول المدة جديد أو تعديل مسودة — نفس قواعد فاتورة الشراء بالظبط:
 *   • كل عملية (حفظ، ترحيل، استبعاد) نية مستقلة بمفتاح مستقل، والـ3 بياخدوا نفس WriteLock
 *     (حجز متزامن قبل البدء) — ضغطتين في نفس الـtick مابيبدأوش غير عملية واحدة.
 *   • كل تأكيد بيعيد فحص القيم الحالية (gateRef + القفل) وقت الضغط، والحوارات busy أثناء العملية.
 *   • الترحيل بيرحّل المسودة المحفوظة بنسختها (مقفول مع تعديلات مش محفوظة).
 *   • حماية المغادرة من UnsavedChangesGuard، والمعاينة مربوطة ببصمة الـpayload (usePreview).
 * الفرق: مفيش مورد ولا مصاريف ولا خصم، وكل بند ليه «التكلفة تقديرية» + ملاحظة إجبارية معاها.
 * PR-D: البنود كروت، والإجماليات والأزرار في شريط ثابت.
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
  const [showIssues, setShowIssues] = useState(false)
  const [revealNonce, setRevealNonce] = useState(0)
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
  const preview = usePreview(previewOpeningAction, built.ok ? payloadFingerprint(built.value) : null)
  const costs = useMemo(() => (preview.preview ? groupLotsByLine(preview.preview.lots) : null), [preview.preview])

  function update(patch: Partial<OpeningFormState>) {
    if (locked) return
    setForm((current) => ({ ...current, ...patch }))
    setDirty(true)
    setLocalError(null)
    setNotice(null)
    preview.reset()
    save.edit()
  }

  function setEstimate(key: string, estimate: LineEstimate) {
    update({ estimates: { ...form.estimates, [key]: estimate } })
  }

  function revealProblems(message: string) {
    setLocalError(message)
    setShowIssues(true)
    setRevealNonce((n) => n + 1)
  }

  function submitSave() {
    if (!editable) return
    if (!built.ok) return revealProblems(built.message)
    save.begin(built.value)
  }

  function runPreview() {
    if (!built.ok) return revealProblems(built.message)
    void preview.run(built.value)
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

  /** التقدير جوه كارت البند العام (renderLineExtra)، **مش** CollapsibleSection مستقل — مقصود: جزء من بيانات
   *  البند، وأخطاؤه (field 'estimate') بتفتح نفس الكارت وبتركّز data-field="estimate"، و«اقفل الكل» بيسيبه مفتوح. */
  function renderEstimate(line: LineForm) {
    const estimate = form.estimates[line.key] ?? { estimated: false, note: '' }
    return (
      <div className="space-y-2 rounded border border-dashed border-border p-2.5">
        <label className="flex items-center gap-2 text-xs font-semibold text-fg">
          <input
            type="checkbox"
            data-field={estimate.estimated ? undefined : 'estimate'}
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
              data-field="estimate"
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
    <div className="space-y-4 max-sm:pb-48">
      <UnsavedChangesGuard active={guardActive} />

      <Card title={draft ? 'مسودة ' + draft.header.docNo : 'رصيد أول مدة جديد'}>
        <div className="grid gap-3 sm:grid-cols-2">
          {locationOptions.length === 1 && locationOptions[0] !== undefined && form.locationId === String(locationOptions[0].id) ? (
            <Field htmlFor="opening-location" label="المخزن" hint="فيه مخزن نشط واحد، فاتحدد تلقائي">
              <p id="opening-location" className="rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-fg">
                {locationOptions[0].label}
              </p>
            </Field>
          ) : (
            <Field htmlFor="opening-location" label="المخزن" hint="مطلوب">
              <select
                id="opening-location"
                value={form.locationId}
                disabled={!editable}
                required
                aria-required="true"
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
          )}
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
          kind="opening"
          totalLabel="إجمالي تكلفة البند (جنيه)"
          showIssues={showIssues}
          revealNonce={revealNonce}
          costs={costs}
          estimates={form.estimates}
          renderLineExtra={renderEstimate}
        />
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
      {preview.error ? (
        <p role="alert" className="text-xs font-semibold text-danger">
          {preview.error}
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

      <InventoryActionBar
        items={[
          { label: 'إجمالي الرصيد', value: money(liveTotals?.itemsTotalPiastres), strong: true },
          { label: 'منه تقديري', value: money(liveTotals?.estimatedTotalPiastres) },
        ]}
        status={
          <>
            {liveTotals ? String(liveTotals.lotCount) + ' دفعة · ' : 'الإجماليات بتظهر لما البيانات تبقى صحيحة · '}
            {preview.preview ? 'المعاينة محدّثة' : 'من غير معاينة'}
            {!mutationsOn ? ' · التعديلات موقوفة دلوقتي (علم الجاهزية)' : ''}
            {draft && postBlocked !== null && !locked ? ' · الترحيل: ' + postBlocked : ''}
          </>
        }
      >
        <Button onClick={submitSave} disabled={!editable}>
          <Save className="h-4 w-4" />
          {save.intent.phase === 'submitting' ? 'بيحفظ…' : draft ? 'حفظ المسودة' : 'حفظ كمسودة'}
        </Button>
        <Button variant="secondary" onClick={runPreview} disabled={preview.previewing || locked}>
          <Eye className="h-4 w-4" />
          {preview.previewing ? 'بيحسب…' : 'معاينة التكلفة'}
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
      </InventoryActionBar>

      {draft ? (
        <>
          <ConfirmDialog
            open={confirmPost}
            title={'ترحيل ' + draft.header.docNo + '؟'}
            message="بعد الترحيل يُقفل المستند، وتُنشأ دفعة لكل لفّة ولكل بند قطع بالتكلفة (وتبقى التكلفة التقديرية معلَّمة كتقديرية). لا يمكن التعديل بعد ذلك، والمتاح هو الإبطال فقط مع ذكر السبب."
            confirmLabel={DOC_ACTION_LABELS.post}
            busy={locked}
            onCancel={() => setConfirmPost(false)}
            onConfirm={() => confirmPostNow({ docId: draft.header.docId, version: draft.header.version })}
          />
          <ReasonDialog
            open={discardOpen}
            kind="discard"
            title={DOC_ACTION_LABELS.discard}
            message="ستُنقل المسودة إلى تبويب «مستبعَد» في القائمة (ولن تظهر في «النشط»)، ولا يمكن تعديلها أو ترحيلها بعد ذلك."
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
