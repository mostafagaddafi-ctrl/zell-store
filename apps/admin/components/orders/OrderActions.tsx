'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addOrderNoteAction, updateOrderStatusAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { ORDER_CANCELLED_FINAL_MESSAGE, type OrderStatus } from '../../lib/enums'
import {
  INTERNAL_NOTES_TEXT,
  TRANSITION_ACTION_LABELS,
  TRANSITION_SAVED_MESSAGE,
  statusControls,
  transitionBusyMessage,
  transitionConfirmation,
} from '../../lib/orders/cycle'
import { useMutationsEnabled } from '../../lib/readiness'
import { Button } from '../ui/Button'
import { Card, textareaClasses } from '../ui/Field'
import { FailureBanner } from '../ui/FailureBanner'

/**
 * أزرار الطلب — مكوّن عميل مستقل.
 *
 * صفحة الطلب Server Component، فماتقدرش تمسك حالة. المكوّن ده بياخد
 * القيم الحالية كـ props وبيعمل refresh بعد كل نجاح.
 *
 * expectedUpdatedAt بييجي من AdminOrderDetail.updatedAt — نفس الطابع
 * للحالة والملاحظات، لأن الاتنين على نفس الصف.
 */

export function OrderStatusControls({
  orderId,
  status,
  gateOpen,
  expectedUpdatedAt,
}: {
  orderId: number
  status: OrderStatus
  /** حالة البوابة من zell_order_gate_state — null = مش معروفة = مقفولة. */
  gateOpen: boolean | null
  expectedUpdatedAt: string
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry } = useSaveAction()
  const [target, setTarget] = useState<OrderStatus | null>(null)

  const stampRef = useRef(expectedUpdatedAt)
  stampRef.current = expectedUpdatedAt
  const targetRef = useRef<OrderStatus | null>(null)

  const busy = state === 'saving'
  // 0021-A A2 — الأهداف من جدول الانتقالات والبوابة (والداتابيز بتتأكد تاني)، مش «أي حالة لأي حالة».
  const controls = statusControls(status, gateOpen, ORDER_CANCELLED_FINAL_MESSAGE)

  function choose(next: OrderStatus) {
    // تأكيد واضح قبل العمليات النهائية أو الخطرة: الإلغاء والتسليم ورفض الاستلام
    const question = transitionConfirmation(next)
    if (question !== null && !window.confirm(question)) return
    targetRef.current = next
    setTarget(next)
    // targetRef عشان «إعادة المحاولة» تبعت آخر حالة مختارة مش الأولى
    void run(() => updateOrderStatusAction(orderId, targetRef.current ?? next, stampRef.current), {
      onSuccess: () => router.refresh(),
    })
  }

  // 0019 — الإلغاء نهائي، والحالات الأخيرة مالهاش انتقالات (والداتابيز بترفض أي محاولة برضه)
  if (controls.kind !== 'buttons') {
    return (
      <Card title="حالة الطلب">
        <p role="status" className="rounded border border-border bg-bg p-2.5 text-xs font-medium text-fg">
          {controls.message}
        </p>
      </Card>
    )
  }

  return (
    <Card title="حالة الطلب">
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          {controls.targets.map((item) => (
            <Button
              key={item}
              variant={item === 'cancelled' ? 'danger' : 'secondary'}
              size="sm"
              disabled={!mutationsOn || busy}
              onClick={() => choose(item)}
            >
              {TRANSITION_ACTION_LABELS[item]}
            </Button>
          ))}
        </div>

        {busy && target !== null ? (
          <p className="text-xs text-muted">{transitionBusyMessage(target)}</p>
        ) : null}
        {state === 'saved' ? <p role="status" className="text-xs text-ok">{TRANSITION_SAVED_MESSAGE}</p> : null}

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}

export function OrderNotes({
  orderId,
  notes,
  expectedUpdatedAt,
}: {
  orderId: number
  notes: string
  expectedUpdatedAt: string
}) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState(notes)

  /** «إعادة المحاولة» لازم تبعت أحدث نص مش نسخة من وقت الضغط الأول. */
  const draftRef = useRef(draft)
  draftRef.current = draft
  const stampRef = useRef(expectedUpdatedAt)
  stampRef.current = expectedUpdatedAt

  // بعد نجاح الحفظ الـ props بتتغيّر، فالنص بيتزامن من السيرفر.
  // لو الحفظ فشل مفيش حاجة بتتغيّر والتعديلات بتفضل.
  const [syncedAt, setSyncedAt] = useState(expectedUpdatedAt)
  useEffect(() => {
    if (expectedUpdatedAt === syncedAt) return
    setSyncedAt(expectedUpdatedAt)
    setDraft(notes)
  }, [notes, expectedUpdatedAt, syncedAt])

  const busy = state === 'saving'

  function save() {
    void run(() => addOrderNoteAction(orderId, draftRef.current, stampRef.current), {
      onSuccess: () => router.refresh(),
    })
  }

  return (
    <Card title={INTERNAL_NOTES_TEXT.title}>
      <div className="space-y-2.5">
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            markDirty()
          }}
          placeholder={INTERNAL_NOTES_TEXT.placeholder}
          className={textareaClasses}
          disabled={!mutationsOn || busy}
        />

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {state === 'dirty' ? INTERNAL_NOTES_TEXT.dirty : null}
            {state === 'saving' ? INTERNAL_NOTES_TEXT.saving : null}
            {state === 'saved' ? INTERNAL_NOTES_TEXT.saved : null}
            {state === 'idle' ? INTERNAL_NOTES_TEXT.hint : null}
          </p>
          <Button size="sm" disabled={!mutationsOn || busy} onClick={save}>
            {INTERNAL_NOTES_TEXT.save}
          </Button>
        </div>

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
