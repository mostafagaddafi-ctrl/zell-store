'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Save, Send, Trash2 } from 'lucide-react'
import {
  createPurchaseAction,
  discardPurchaseAction,
  postPurchaseAction,
  previewPurchaseAction,
  updatePurchaseAction,
} from '../../lib/inventoryActions'
import { useInventoryIntent } from '../../lib/client/useInventoryIntent'
import { usePreview } from '../../lib/client/usePreview'
import type { CatalogProduct } from '../../lib/inventory/catalog'
import { normalizeForSearch } from '../../lib/inventory/docList'
import { duplicateFormBlockers, duplicateToForm, type DuplicateSeed } from '../../lib/inventory/purchaseDuplicate'
import { DOC_ACTION_LABELS } from '../../lib/inventory/labels'
import { formatPiastresExact } from '../../lib/inventory/money'
import { groupLotsByLine } from '../../lib/inventory/pricing'
import { payloadFingerprint } from '../../lib/inventory/previewTracker'
import {
  PURCHASE_LIMITS,
  buildPurchasePayload,
  draftTotals,
  emptyPurchaseForm,
  payloadToForm,
  postReadinessIssues,
  type PurchaseDocPayload,
  type PurchaseFormState,
} from '../../lib/inventory/purchaseForm'
import type { InventoryLocationOption, PurchaseHeader, PurchaseWriteResult } from '../../lib/inventory/purchases'
import type { InventorySupplier } from '../../lib/inventory/suppliers'
import { canConfirm, createWriteLock, type WriteLock } from '../../lib/inventory/writeLock'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'
import { CollapsibleSection } from './CollapsibleSection'
import { InventoryActionBar } from './InventoryActionBar'
import { PurchaseChargesEditor } from './PurchaseChargesEditor'
import { PurchaseLinesEditor } from './PurchaseLinesEditor'
import { ReasonDialog } from './ReasonDialog'
import { UnresolvedNotice } from './UnresolvedNotice'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

type Draft = { header: PurchaseHeader; payload: PurchaseDocPayload }
type DocRef = { docId: number; version: number }
type DiscardPayload = DocRef & { reason: string }

const REPLAYED_MESSAGE = 'سبق تنفيذ هذه العملية، وتم عرض نتيجتها دون تكرار.'
const money = (piastres: number | undefined) => (piastres === undefined ? '—' : formatPiastresExact(piastres))

/**
 * فاتورة شراء جديدة أو تعديل مسودة.
 *
 * كل عملية نية مستقلة بمفتاح مستقل (useInventoryIntent): حفظ · ترحيل · استبعاد. ونية واحدة بس
 * مفتوحة في نفس الوقت — أي نية مش في editing (أو مصالحة جارية) بتقفل الحقول وباقي الأزرار.
 *
 * 🔒 القفل الفوري: الـ3 hooks بياخدوا نفس WriteLock (ref على مستوى المستند)، وbegin بيحجزه بشكل
 *    متزامن — فضغطتين في نفس الـtick مابيبدأوش غير عملية واحدة. وكل تأكيد (ترحيل/استبعاد) بيعيد فحص
 *    القيم الحالية (gateRef + القفل) وقت الضغط نفسه، مش من closure قديم.
 * الترحيل بيرحّل **المسودة المحفوظة** بنسختها، فلازم مفيش تعديلات مش محفوظة.
 * المعاينة قراءة بس (usePreview) ومربوطة ببصمة الـpayload — أي رد قديم بيتهمل.
 * PR-D: البنود كروت (PurchaseLinesEditor)، والإجماليات والأزرار في شريط ثابت (InventoryActionBar).
 */
export function PurchaseEditor({
  draft,
  catalog,
  suppliers,
  locations,
  today,
  duplicate,
}: {
  draft: Draft | null
  catalog: CatalogProduct[]
  suppliers: InventorySupplier[]
  locations: InventoryLocationOption[]
  today: string
  /** تكرار فاتورة: نموذج جديد متملي من الأصل (lib/inventory/purchaseDuplicate.ts) — بيتحفظ بنفس «حفظ» العادي. */
  duplicate?: DuplicateSeed
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const keyRef = useRef(0)
  const newKey = () => {
    keyRef.current += 1
    return 'f' + String(keyRef.current)
  }
  const catalogMap = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog])
  const defaultLocation = locations.find((location) => location.isDefault) ?? locations[0]

  const [form, setForm] = useState<PurchaseFormState>(() =>
    draft
      ? payloadToForm(draft.payload, newKey)
      : duplicate
        ? duplicateToForm(duplicate, newKey)
        : emptyPurchaseForm({ locationId: defaultLocation ? defaultLocation.locationId : null, today }),
  )
  const [dirty, setDirty] = useState(duplicate !== undefined)
  const [supplierQuery, setSupplierQuery] = useState('')
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

  const save = useInventoryIntent<PurchaseDocPayload, PurchaseWriteResult>(
    (commandId, payload) =>
      draft
        ? updatePurchaseAction(commandId, draft.header.docId, draft.header.version, payload)
        : createPurchaseAction(commandId, payload),
    {
      onDone: (result) => {
        setDirty(false)
        if (!draft) {
          router.replace('/inventory/purchases/' + String(result.docId))
          return
        }
        setNotice(result.replayed === true ? REPLAYED_MESSAGE : 'اتحفظت المسودة.')
        startReconcile(() => router.refresh())
      },
      onAbandon: () => {
        setDirty(false)
        // إنشاء غير محسوم: المراجعة في قايمة المسودات قبل أي إنشاء جديد
        if (!draft) {
          router.push('/inventory/purchases?status=draft')
          return
        }
        startReconcile(() => router.refresh())
      },
    },
    { lock, owner: 'save' },
  )

  const post = useInventoryIntent<DocRef, PurchaseWriteResult>(
    (commandId, ref) => postPurchaseAction(commandId, ref.docId, ref.version),
    {
      onDone: (result) => {
        setNotice(result.replayed === true ? REPLAYED_MESSAGE : 'اترحّلت الفاتورة.')
        startReconcile(() => router.refresh())
      },
      onAbandon: reconcile,
    },
    { lock, owner: 'post' },
  )

  const discard = useInventoryIntent<DiscardPayload, PurchaseWriteResult>(
    (commandId, ref) => discardPurchaseAction(commandId, ref.docId, ref.version, ref.reason),
    {
      onDone: (result) => {
        setNotice(result.replayed === true ? REPLAYED_MESSAGE : 'اتستبعدت المسودة.')
        startReconcile(() => router.refresh())
      },
      onAbandon: reconcile,
    },
    { lock, owner: 'discard' },
  )

  // بعد ما المصالحة (router.refresh) تخلص: النيات المتروكة أو الناجحة ترجع للتعديل
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

  const built = useMemo(() => buildPurchasePayload(form, catalogMap, today), [form, catalogMap, today])
  const activeSupplierIds = useMemo(() => new Set(suppliers.map((supplier) => supplier.supplierId)), [suppliers])
  const activeLocationIds = useMemo(() => new Set(locations.map((location) => location.locationId)), [locations])
  const blockers = useMemo(
    () =>
      duplicate
        ? duplicateFormBlockers(form, {
            catalog: catalogMap,
            activeSupplierIds,
            activeLocationIds,
            supplierRequired: duplicate.supplierCleared,
          })
        : [],
    [duplicate, form, catalogMap, activeSupplierIds, activeLocationIds],
  )
  const liveTotals = built.ok ? draftTotals(built.value) : null
  const savedIssues = draft ? postReadinessIssues(draft.payload) : []
  const preview = usePreview(previewPurchaseAction, built.ok ? payloadFingerprint(built.value) : null)
  const costs = useMemo(() => (preview.preview ? groupLotsByLine(preview.preview.lots) : null), [preview.preview])

  function update(patch: Partial<PurchaseFormState>) {
    if (locked) return
    setForm((current) => ({ ...current, ...patch }))
    setDirty(true)
    setLocalError(null)
    setNotice(null)
    preview.reset()
    save.edit()
  }

  /** فشل التحقق المحلي: الرسالة فوق، والبنود اللي فيها مشكلة بتتفتح وأول خانة غلط بتاخد focus. */
  function revealProblems(message: string) {
    setLocalError(message)
    setShowIssues(true)
    setRevealNonce((n) => n + 1)
  }

  function submitSave() {
    if (!editable) return
    if (blockers.length > 0) return revealProblems(blockers[0] ?? '')
    if (!built.ok) return revealProblems(built.message)
    save.begin(built.value)
  }

  function runPreview() {
    if (!built.ok) return revealProblems(built.message)
    void preview.run(built.value)
  }

  // اختيارات المورد والمخزن: النشطين، ومعاهم المختار في المسودة لو اتوقف (عشان يبان، والحفظ هيرفضه)
  const supplierOptions = suppliers.map((s) => ({ id: s.supplierId, label: s.name }))
  if (draft && draft.header.supplierId !== null && !suppliers.some((s) => s.supplierId === draft.header.supplierId)) {
    supplierOptions.push({ id: draft.header.supplierId, label: (draft.header.supplierName ?? 'مورد') + ' (موقوف)' })
  }
  const supplierNeedle = normalizeForSearch(supplierQuery)
  const visibleSupplierOptions =
    supplierNeedle === ''
      ? supplierOptions
      : supplierOptions.filter(
          (option) => normalizeForSearch(option.label).includes(supplierNeedle) || String(option.id) === form.supplierId,
        )
  const locationOptions = locations.map((l) => ({ id: l.locationId, label: l.name }))
  if (draft && !locations.some((l) => l.locationId === draft.header.locationId)) {
    locationOptions.push({ id: draft.header.locationId, label: draft.header.locationName + ' (موقوف)' })
  }

  const postBlocked = !draft
    ? 'احفظ المسودة الأول.'
    : dirty
      ? 'يُرجى حفظ التعديلات أولًا، إذ يتم ترحيل المسودة المحفوظة.'
      : savedIssues.length > 0
        ? savedIssues.join(' ')
        : null

  // القيم الحالية لبوابة التأكيد — بتتحدث كل render وبتتقرا وقت الضغط نفسه
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

  const saveFailure = save.intent.phase === 'editing' ? save.intent.failure : null
  const postFailure = post.intent.phase === 'editing' ? post.intent.failure : null
  const discardFailure = discard.intent.phase === 'editing' ? discard.intent.failure : null

  return (
    <div className="space-y-4 max-sm:pb-48">
      <UnsavedChangesGuard active={guardActive} />

      {duplicate ? (
        <div role="note" className="space-y-1.5 rounded-lg border-s-2 border-brand bg-brand/5 px-3 py-2.5 text-xs leading-relaxed text-fg">
          <p className="font-semibold">
            نسخة من فاتورة <bdi dir="ltr">{duplicate.sourceDocNo}</bdi>، ولسه مااتحفظتش.
          </p>
          <p className="text-muted">
            يُرجى مراجعة البيانات وتعديلها عند الحاجة، ولا تُنشأ المسودة الجديدة إلا بعد الضغط على «حفظ». التاريخ هو تاريخ اليوم، ورقم فاتورة المورد فارغ، ولا تتغيّر الفاتورة الأصلية.
          </p>
          {duplicate.notes.length > 0 ? (
            <ul className="list-disc space-y-0.5 ps-4 font-medium text-fg marker:text-gold">
              {duplicate.notes.map((note, index) => (
                <li key={String(index)}>{note}</li>
              ))}
            </ul>
          ) : null}
          {blockers.length > 0 ? (
            <ul role="alert" className="list-disc space-y-0.5 ps-4 text-danger">
              {blockers.map((blocker, index) => (
                <li key={String(index)}>{blocker}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Card title={draft ? 'مسودة ' + draft.header.docNo : duplicate ? 'نسخة من ' + duplicate.sourceDocNo : 'فاتورة شراء جديدة'}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="purchase-supplier" label="المورد" hint="اختياري في المسودة · لا يظهر المورد الموقوف هنا">
            {editable && supplierOptions.length > 5 ? (
              <input
                type="search"
                value={supplierQuery}
                onChange={(event) => setSupplierQuery(event.target.value)}
                placeholder="ابحث باسم المورد"
                aria-label="بحث عن مورد"
                className={inputClasses + ' mb-1.5'}
              />
            ) : null}
            <select
              id="purchase-supplier"
              value={form.supplierId}
              disabled={!editable}
              onChange={(event) => update({ supplierId: event.target.value })}
              className={inputClasses}
            >
              <option value="">من غير مورد</option>
              {visibleSupplierOptions.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="purchase-ref" label="رقم فاتورة المورد" hint={'اختياري · لحد ' + String(PURCHASE_LIMITS.supplierRef) + ' حرف'}>
            <input
              id="purchase-ref"
              value={form.supplierRef}
              maxLength={PURCHASE_LIMITS.supplierRef + 20}
              disabled={!editable}
              onChange={(event) => update({ supplierRef: event.target.value })}
              className={inputClasses}
            />
          </Field>
          {locationOptions.length === 1 && locationOptions[0] !== undefined && form.locationId === String(locationOptions[0].id) ? (
            <Field htmlFor="purchase-location" label="المخزن" hint="فيه مخزن نشط واحد، فاتحدد تلقائي">
              <p id="purchase-location" className="rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-fg">
                {locationOptions[0].label}
              </p>
            </Field>
          ) : (
            <Field htmlFor="purchase-location" label="المخزن" hint="مطلوب">
              <select
                id="purchase-location"
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
          <Field htmlFor="purchase-date" label="تاريخ الفاتورة" hint="لا يكون في المستقبل (بتوقيت القاهرة)">
            <input
              id="purchase-date"
              type="date"
              dir="ltr"
              max={today}
              value={form.docDate}
              disabled={!editable}
              onChange={(event) => update({ docDate: event.target.value })}
              className={inputClasses}
            />
          </Field>
        </div>
        <Field htmlFor="purchase-note" label="ملاحظة" hint={'اختياري · لحد ' + String(PURCHASE_LIMITS.note) + ' حرف'} className="mt-3">
          <textarea
            id="purchase-note"
            value={form.note}
            maxLength={PURCHASE_LIMITS.note + 50}
            disabled={!editable}
            onChange={(event) => update({ note: event.target.value })}
            className={textareaClasses}
          />
        </Field>
      </Card>

      <Card title="البنود">
        <PurchaseLinesEditor
          lines={form.lines}
          onChange={(lines) => update({ lines })}
          catalog={catalog}
          disabled={!editable}
          newKey={newKey}
          kind="purchase"
          totalLabel="إجمالي سعر شراء البند (جنيه)"
          showIssues={showIssues}
          revealNonce={revealNonce}
          costs={costs}
        />
      </Card>

      <CollapsibleSection title="المصاريف الإضافية" summary={String(form.charges.length) + ' مصروف'} defaultOpen={form.charges.length > 0}>
        <PurchaseChargesEditor charges={form.charges} onChange={(charges) => update({ charges })} disabled={!editable} newKey={newKey} />
      </CollapsibleSection>

      <CollapsibleSection title="خصم المورد" summary={form.discount.trim() === '' ? 'من غير خصم' : form.discount + ' ج.م'} defaultOpen={form.discount.trim() !== ''}>
        <Field htmlFor="purchase-discount" label="خصم المورد (جنيه)" hint="اختياري · لازم يكون أقل من إجمالي البنود وقت الترحيل" className="max-w-xs">
          <input
            id="purchase-discount"
            dir="ltr"
            inputMode="decimal"
            value={form.discount}
            disabled={!editable}
            onChange={(event) => update({ discount: event.target.value })}
            className={inputClasses}
          />
        </Field>
      </CollapsibleSection>

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
          { label: 'إجمالي البنود', value: money(liveTotals?.itemsSubtotalPiastres) },
          { label: 'المصاريف', value: money(liveTotals?.extrasTotalPiastres) },
          { label: 'الخصم', value: money(liveTotals?.supplierDiscountPiastres) },
          { label: 'الإجمالي النهائي', value: money(liveTotals?.totalCostPiastres), strong: true },
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
            message="بعد الترحيل تُقفل الفاتورة، وتُنشأ دفعة لكل لفّة ولكل بند قطع بالتكلفة النهائية. لا يمكن التعديل بعد ذلك، والمتاح هو الإبطال فقط مع ذكر السبب."
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
