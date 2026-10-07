'use client'

import { useRef, useState } from 'react'
import type { InventoryResult } from '../inventory/errors'
import {
  abandonIntent,
  canEditPayload,
  editIntent,
  initialIntent,
  isLeaveRisky,
  retryIntent,
  type IntentOutcome,
  type IntentState,
} from '../inventory/intent'
import {
  createWriteLock,
  releaseAfterReconcile,
  settleLockedIntent,
  startLockedIntent,
  type WriteLock,
} from '../inventory/writeLock'

/**
 * نية كتابة واحدة لعملية واحدة (lib/inventory/intent.ts) — كل عملية (حفظ، ترحيل، استبعاد، إبطال)
 * بتستخدم نسخة مستقلة من الهوك ده، فالمفتاح مابيتعادش بين عمليتين.
 *
 * 🔒 القفل المشترك (lib/inventory/writeLock.ts): كل العمليات على نفس المستند بتاخد نفس الـlock،
 *    وbegin بيحجزه **بشكل متزامن** قبل أي state update — فضغطتين في نفس الـtick (تأكيد مرتين، أو
 *    ترحيل + استبعاد) مابيبدأوش غير عملية واحدة. ولو مااتبعتش lock، الهوك بيعمل واحد لنفسه.
 *
 *   • begin(payload): مفتاح جديد (crypto.randomUUID) بعد ما المستدعي يخلّص التحقق المحلي. false = ممنوع.
 *   • retry(): نفس المفتاح ونفس الـpayload المتجمّد (unresolved بس، ومش hard). القفل لسه محجوز.
 *   • abandon(): «ترك المحاولة ومراجعة الحالة» — مابيلغيش حاجة في الداتابيز، والقفل بيفضل محجوز؛
 *     المستدعي بيعمل المصالحة في onAbandon، وبعدها بينادي afterReconcile().
 *   • afterReconcile(): بعد ما القراءة الجديدة تخلص: abandoned/done → editing، والقفل بيتحرر.
 */
export function useInventoryIntent<P, R>(
  send: (commandId: string, payload: P) => Promise<InventoryResult<R>>,
  handlers: { onDone: (data: R) => void; onAbandon: () => void },
  coordination?: { lock: WriteLock; owner: string },
) {
  const [intent, setIntentState] = useState<IntentState<P>>(() => initialIntent<P>())
  const intentRef = useRef(intent)
  const ownLockRef = useRef<WriteLock | null>(null)
  if (ownLockRef.current === null) ownLockRef.current = createWriteLock()
  const lock = coordination ? coordination.lock : ownLockRef.current
  const owner = coordination ? coordination.owner : 'self'

  const sendRef = useRef(send)
  sendRef.current = send
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  function set(next: IntentState<P>) {
    intentRef.current = next
    setIntentState(next)
  }

  async function dispatch(state: IntentState<P>) {
    if (state.phase !== 'submitting') return
    const { commandId, payload } = state
    let outcome: IntentOutcome
    let data: { value: R } | null = null
    try {
      const result = await sendRef.current(commandId, payload)
      if (result.ok) {
        outcome = { ok: true }
        data = { value: result.data }
      } else {
        outcome = { ok: false, code: result.code, message: result.message, resolution: result.resolution }
      }
    } catch {
      outcome = { thrown: true }
    }
    const next = settleLockedIntent(lock, owner, intentRef.current, commandId, outcome)
    set(next)
    if (next.phase === 'done' && data !== null) handlersRef.current.onDone(data.value)
  }

  function begin(payload: P): boolean {
    const next = startLockedIntent(lock, owner, intentRef.current, payload, crypto.randomUUID())
    if (next === null) return false
    set(next)
    void dispatch(next)
    return true
  }

  function retry() {
    const next = retryIntent(intentRef.current)
    if (next === null) return
    set(next)
    void dispatch(next)
  }

  function abandon() {
    const next = abandonIntent(intentRef.current)
    if (next === null) return
    set(next)
    handlersRef.current.onAbandon()
  }

  function afterReconcile() {
    const next = releaseAfterReconcile(lock, owner, intentRef.current)
    if (next !== intentRef.current) set(next)
  }

  function edit() {
    const next = editIntent(intentRef.current)
    if (next !== intentRef.current) set(next)
  }

  return {
    intent,
    begin,
    retry,
    abandon,
    afterReconcile,
    edit,
    canEdit: canEditPayload(intent),
    risky: isLeaveRisky(intent),
  }
}
