'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addOrderNoteAction, updateOrderStatusAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '../../lib/enums'
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
  expectedUpdatedAt,
}: {
  orderId: number
  status: OrderStatus
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

  function choose(next: OrderStatus) {
    targetRef.current = next
    setTarget(next)
    // targetRef عشان «حاول تاني» تبعت آخر حالة مختارة مش الأولى
    void run(() => updateOrderStatusAction(orderId, targetRef.current ?? next, stampRef.current), {
      onSuccess: () => router.refresh(),
    })
  }

  return (
    <Card title="الحالة">
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          {ORDER_STATUSES.map((item) => (
            <Button
              key={item}
              variant={item === status ? 'primary' : 'secondary'}
              size="sm"
              disabled={!mutationsOn || busy || item === status}
              onClick={() => choose(item)}
            >
              {ORDER_STATUS_LABELS[item]}
            </Button>
          ))}
        </div>

        {busy && target !== null ? (
          <p className="text-xs text-muted">بيغيّر لـ {ORDER_STATUS_LABELS[target]}…</p>
        ) : null}
        {state === 'saved' ? <p className="text-xs text-ok">الحالة اتغيّرت</p> : null}

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

  /** «حاول تاني» لازم تبعت أحدث نص مش نسخة من وقت الضغط الأول. */
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
    <Card title="ملاحظات داخلية">
      <div className="space-y-2.5">
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            markDirty()
          }}
          placeholder="ملاحظات للفريق — ما بتظهرش للعميل"
          className={textareaClasses}
          disabled={!mutationsOn || busy}
        />

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {state === 'dirty' ? 'فيه تغييرات مش محفوظة' : null}
            {state === 'saving' ? 'بيحفظ…' : null}
            {state === 'saved' ? 'اتحفظ' : null}
            {state === 'idle' ? 'للفريق بس — ما بتظهرش للعميل' : null}
          </p>
          <Button size="sm" disabled={!mutationsOn || busy} onClick={save}>
            حفظ الملاحظات
          </Button>
        </div>

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      </div>
    </Card>
  )
}
