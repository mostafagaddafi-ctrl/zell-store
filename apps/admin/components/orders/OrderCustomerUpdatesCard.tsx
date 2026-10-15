'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Pencil } from 'lucide-react'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { addCustomerUpdateAction, editCustomerUpdateAction, setCustomerUpdateHiddenAction } from '../../lib/orderActions'
import { formatCairoDateTime } from '../../lib/orders/cycle'
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
 * الإضافة بنسخة القايمة (last_id)، والتعديل والإخفاء بنسخة الرسالة (updated_at). القرار النهائي في zell_customer_update_*.
 * التعارض (45404): إعادة قراية تلقائية (router.refresh) مع الاحتفاظ بالنص اللي لسه ماتحفظش، ومفيش إعادة إرسال تلقائية.
 * الرسايل بتتعرض كنص (من غير HTML). السجل الداخلي للتغييرات مابيظهرش هنا ولا للعميل.
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
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editIssue, setEditIssue] = useState<string | null>(null)
  const [rowDone, setRowDone] = useState<RowDone | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const busy = adder.state === 'saving' || rows.state === 'saving'

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

  const disabled = !mutationsOn || busy
  const full = !canAddUpdate(view)

  function versionOf(id: number): string | null {
    const row = viewRef.current?.updates.find((u) => u.id === id)
    return row === undefined ? null : row.updatedAt
  }

  function add() {
    const checked = updateText(draft)
    if (!checked.ok) {
      setAddIssue(checked.message)
      return
    }
    setAddIssue(null)
    const lastId = viewRef.current?.lastId ?? null
    const text = checked.value
    void adder.run(() => addCustomerUpdateAction(orderNumber, lastId, text), {
      onSuccess: () => {
        setDraft('')
        router.refresh()
      },
    })
  }

  function startEdit(id: number, text: string) {
    setEditingId(id)
    setEditText(text)
    setEditIssue(null)
    setRowDone(null)
    rows.reset()
  }

  function saveEdit(id: number) {
    const checked = updateText(editText)
    if (!checked.ok) {
      setEditIssue(checked.message)
      return
    }
    const version = versionOf(id)
    if (version === null) return
    setEditIssue(null)
    const text = checked.value
    void rows.run(() => editCustomerUpdateAction(orderNumber, id, version, text), {
      onSuccess: (data) => {
        setRowDone(data.changed ? 'edit' : 'unchanged')
        setEditingId(null)
        setEditText('')
        router.refresh()
      },
    })
  }

  function toggleHidden(id: number, hidden: boolean) {
    if (hidden && !window.confirm(UPDATES_TEXT.hideConfirm)) return
    const version = versionOf(id)
    if (version === null) return
    void rows.run(() => setCustomerUpdateHiddenAction(orderNumber, id, version, hidden), {
      onSuccess: (data) => {
        setRowDone(data.changed ? (hidden ? 'hidden' : 'shown') : 'unchanged')
        router.refresh()
      },
    })
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

        <p className="text-xs text-muted">{updatesCountLine(view.updates.length)}</p>

        {view.updates.length === 0 ? (
          <p className="text-sm text-fg">{UPDATES_TEXT.empty}</p>
        ) : (
          <ul className="space-y-2">
            {view.updates.map((u) => (
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

                {editingId === u.id ? (
                  <div className="space-y-2">
                    <Field htmlFor={'customer-update-' + String(u.id)} label={UPDATES_TEXT.edit} error={editIssue ?? undefined} hint={charsLine(editText)}>
                      <textarea
                        id={'customer-update-' + String(u.id)}
                        value={editText}
                        maxLength={UPDATE_TEXT_MAX * 2}
                        onChange={(event) => {
                          setEditText(event.target.value)
                          setEditIssue(null)
                          if (rows.state !== 'idle' && rows.state !== 'saving') rows.markDirty()
                        }}
                        className={textareaClasses}
                        disabled={disabled}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={disabled} onClick={() => saveEdit(u.id)}>
                        {UPDATES_TEXT.saveEdit}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(null)
                          setEditText('')
                          setEditIssue(null)
                          rows.reset()
                        }}
                      >
                        {UPDATES_TEXT.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words text-sm">{u.text}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={disabled || editingId !== null} onClick={() => startEdit(u.id, u.text)}>
                        <Pencil className="h-3.5 w-3.5" />
                        {UPDATES_TEXT.edit}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={disabled || editingId !== null} onClick={() => toggleHidden(u.id, !u.hidden)}>
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
