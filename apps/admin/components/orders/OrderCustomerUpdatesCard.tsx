'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Pencil } from 'lucide-react'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { addCustomerUpdateAction, editCustomerUpdateAction, setCustomerUpdateHiddenAction } from '../../lib/orderActions'
import { formatCairoDateTime } from '../../lib/orders/cycle'
import {
  addIntentOf,
  adoptEditLatest,
  boundSend,
  editDraftOf,
  editDraftStale,
  editIntentOf,
  hideIntentOf,
  syncEditDraft,
  type AddIntent,
  type EditIntent,
  type HideIntent,
  type UpdateEditDraft,
} from '../../lib/orders/trackDrafts'
import {
  UPDATES_TEXT,
  UPDATE_TEXT_MAX,
  canAddUpdate,
  charsLine,
  updateText,
  updatesCountLine,
  type UpdatesView,
} from '../../lib/orders/trackUpdates'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, Field, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * TRACK-ORDER v2 W2-B — كارت «رسائل للعميل» في صفحة الطلب (العقد TRACK-ORDER-v2 §٦ · §١٧-٢): إضافة · تعديل النص · إخفاء/إظهار.
 * التعديل ليه نسخة بداية منفصلة عن أحدث نسخة معروضة (lib/orders/trackDrafts.ts): لو الرسالة اتغيّرت أثناء التعديل، النص
 * بيفضل، والنص المحفوظ حاليًا بيظهر للمراجعة، والحفظ بيتقفل لحد «اعتماد أحدث نسخة مع الاحتفاظ بما كتبته» أو «تجاهل ما كتبته».
 * كل إجراء بنية ثابتة لحظة الضغط (النسخة + النص/الحالة)، وإعادة المحاولة بتبعتها بالحرف. التعارض (45404): إعادة قراية
 * تلقائية (router.refresh) مع الاحتفاظ بالنص، ومفيش إعادة إرسال تلقائية. الرسايل بتتعرض كنص (من غير HTML).
 */
type RowDone = 'edit' | 'unchanged' | 'hidden' | 'shown'

const ROW_DONE_TEXT: Record<RowDone, string> = {
  edit: UPDATES_TEXT.editSaved,
  unchanged: UPDATES_TEXT.unchanged,
  hidden: UPDATES_TEXT.hiddenDone,
  shown: UPDATES_TEXT.shownDone,
}

export function OrderCustomerUpdatesCard({ orderNumber, view }: { orderNumber: string; view: UpdatesView | null }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const adder = useSaveAction()
  const rows = useSaveAction()
  const [draft, setDraft] = useState('')
  const [addIssue, setAddIssue] = useState<string | null>(null)
  const [edit, setEdit] = useState<UpdateEditDraft | null>(null)
  const [editIssue, setEditIssue] = useState<string | null>(null)
  const [rowDone, setRowDone] = useState<RowDone | null>(null)
  const busy = adder.state === 'saving' || rows.state === 'saving'

  // props جديدة: التعديل اللي فيه نص متغيّر بيفضل على نسخته، واللي ماتغيّرش بيتبع السيرفر.
  useEffect(() => {
    setEdit((current) => (current === null ? current : syncEditDraft(current, view)))
  }, [view])

  // 45404: نقرا أحدث نسخة من غير ما نمسح النص اللي اتكتب.
  useEffect(() => {
    if (adder.state === 'conflict' || rows.state === 'conflict') router.refresh()
  }, [adder.state, rows.state, router])

  if (view === null) {
    return (
      <Card title={UPDATES_TEXT.title}>
        <p className="text-xs text-muted">{UPDATES_TEXT.unavailable}</p>
      </Card>
    )
  }

  const latest = view
  const disabled = !mutationsOn || busy
  const full = !canAddUpdate(latest)
  const editStale = edit !== null && editDraftStale(edit, latest)

  function add() {
    const checked = updateText(draft)
    if (!checked.ok) {
      setAddIssue(checked.message)
      return
    }
    setAddIssue(null)
    const intent = addIntentOf(latest, checked.value)
    void adder.run(
      boundSend(intent, (i: AddIntent) => addCustomerUpdateAction(orderNumber, i.expectedLastId, i.text)),
      {
        onSuccess: () => {
          setDraft('')
          router.refresh()
        },
      },
    )
  }

  function startEdit(id: number) {
    setEdit(editDraftOf(latest, id))
    setEditIssue(null)
    setRowDone(null)
    rows.reset()
  }

  function closeEdit() {
    setEdit(null)
    setEditIssue(null)
    rows.reset()
  }

  function adoptEdit() {
    setEdit((current) => (current === null ? current : adoptEditLatest(current, latest)))
    setEditIssue(null)
    rows.reset()
  }

  function discardEdit() {
    setEdit((current) => (current === null ? current : editDraftOf(latest, current.id)))
    setEditIssue(null)
    rows.reset()
  }

  function saveEdit() {
    if (edit === null || editStale) return
    const checked = updateText(edit.text)
    if (!checked.ok) {
      setEditIssue(checked.message)
      return
    }
    setEditIssue(null)
    const intent = editIntentOf(edit, checked.value)
    void rows.run(
      boundSend(intent, (i: EditIntent) => editCustomerUpdateAction(orderNumber, i.id, i.expectedUpdatedAt, i.text)),
      {
        onSuccess: (data) => {
          setRowDone(data.changed ? 'edit' : 'unchanged')
          setEdit(null)
          router.refresh()
        },
      },
    )
  }

  function toggleHidden(id: number, hidden: boolean) {
    if (hidden && !window.confirm(UPDATES_TEXT.hideConfirm)) return
    const intent = hideIntentOf(latest, id, hidden)
    if (intent === null) return
    void rows.run(
      boundSend(intent, (i: HideIntent) => setCustomerUpdateHiddenAction(orderNumber, i.id, i.expectedUpdatedAt, i.hidden)),
      {
        onSuccess: (data) => {
          setRowDone(data.changed ? (hidden ? 'hidden' : 'shown') : 'unchanged')
          router.refresh()
        },
      },
    )
  }

  return (
    <Card title={UPDATES_TEXT.title}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted">{UPDATES_TEXT.intro}</p>

        {full ? (
          <p className="rounded border border-gold bg-gold/10 p-2 text-xs text-fg">{UPDATES_TEXT.limitReached}</p>
        ) : (
          <div className="space-y-2">
            <Field htmlFor="customer-update-new" label={UPDATES_TEXT.newLabel} error={addIssue ?? undefined} hint={charsLine(draft)}>
              <textarea
                id="customer-update-new"
                value={draft}
                maxLength={UPDATE_TEXT_MAX * 2}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setAddIssue(null)
                  if (adder.state !== 'idle' && adder.state !== 'saving') adder.markDirty()
                }}
                className={textareaClasses}
                disabled={disabled}
              />
            </Field>
            {adder.state === 'saved' ? (
              <p role="status" className="text-xs text-ok">
                {UPDATES_TEXT.added}
              </p>
            ) : null}
            <Button size="sm" disabled={disabled} onClick={add}>
              {UPDATES_TEXT.add}
            </Button>
            <FailureBanner failure={adder.failure} onRetry={adder.retry} />
          </div>
        )}

        <p className="text-xs text-muted">{updatesCountLine(latest.updates.length)}</p>

        {latest.updates.length === 0 ? (
          <p className="text-sm text-fg">{UPDATES_TEXT.empty}</p>
        ) : (
          <ul className="space-y-2">
            {latest.updates.map((u) => (
              <li key={u.id} className={'rounded border border-border p-2 text-xs ' + (u.hidden ? 'bg-bg text-muted' : 'bg-surface text-fg')}>
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {u.hidden ? (
                    <span className="rounded bg-danger/10 px-1.5 py-0.5 font-semibold text-danger">{UPDATES_TEXT.hiddenBadge}</span>
                  ) : null}
                  {u.edited ? (
                    <span className="rounded bg-gold/15 px-1.5 py-0.5 font-semibold text-fg">{UPDATES_TEXT.editedBadge}</span>
                  ) : null}
                  <span className="text-muted">{UPDATES_TEXT.addedAt + formatCairoDateTime(u.createdAt)}</span>
                </div>

                {edit !== null && edit.id === u.id ? (
                  <div className="space-y-2">
                    {editStale ? (
                      <div role="alert" className="space-y-2 rounded border-s-2 border-gold bg-gold/10 p-2 text-fg">
                        <p>{UPDATES_TEXT.stale}</p>
                        <p className="font-semibold">{UPDATES_TEXT.currentSaved}</p>
                        <p className="whitespace-pre-wrap break-words">{u.text}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" disabled={busy} onClick={adoptEdit}>
                            {UPDATES_TEXT.adopt}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={discardEdit}>
                            {UPDATES_TEXT.discard}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <Field htmlFor={'customer-update-' + String(u.id)} label={UPDATES_TEXT.edit} error={editIssue ?? undefined} hint={charsLine(edit.text)}>
                      <textarea
                        id={'customer-update-' + String(u.id)}
                        value={edit.text}
                        maxLength={UPDATE_TEXT_MAX * 2}
                        onChange={(event) => {
                          const text = event.target.value
                          setEdit((current) => (current === null ? current : { ...current, text }))
                          setEditIssue(null)
                          if (rows.state !== 'idle' && rows.state !== 'saving') rows.markDirty()
                        }}
                        className={textareaClasses}
                        disabled={disabled}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={disabled || editStale} onClick={saveEdit}>
                        {UPDATES_TEXT.saveEdit}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={closeEdit}>
                        {UPDATES_TEXT.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words text-sm">{u.text}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={disabled || edit !== null} onClick={() => startEdit(u.id)}>
                        <Pencil className="h-3.5 w-3.5" />
                        {UPDATES_TEXT.edit}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={disabled || edit !== null} onClick={() => toggleHidden(u.id, !u.hidden)}>
                        {u.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        {u.hidden ? UPDATES_TEXT.show : UPDATES_TEXT.hide}
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {rows.state === 'saved' && rowDone !== null ? (
          <p role="status" className="text-xs text-ok">
            {ROW_DONE_TEXT[rowDone]}
          </p>
        ) : null}
        <FailureBanner failure={rows.failure} onRetry={rows.retry} />
      </div>
    </Card>
  )
}
