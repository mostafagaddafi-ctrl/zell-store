'use client'

import { useRef, useState } from 'react'
import type { InventoryResult } from '../inventory/errors'
import {
  abandonIntent,
  beginIntent,
  canEditPayload,
  editIntent,
  initialIntent,
  isLeaveRisky,
  reopenAfterReconcile,
  resetAfterDone,
  retryIntent,
  settleIntent,
  type IntentOutcome,
  type IntentState,
} from '../inventory/intent'

/**
 * نية كتابة واحدة لعملية واحدة (lib/inventory/intent.ts) — كل عملية (حفظ، ترحيل، استبعاد، إبطال)
 * بتستخدم نسخة مستقلة من الهوك ده، فالمفتاح مابيتعادش بين عمليتين.
 *
 *   • begin(payload): مفتاح جديد (crypto.randomUUID) بعد ما المستدعي يخلّص التحقق المحلي.
 *   • retry(): نفس المفتاح ونفس الـpayload المتجمّد (unresolved بس، ومش hard).
 *   • abandon(): «ترك المحاولة ومراجعة الحالة» — مابيلغيش حاجة في الداتابيز؛ المستدعي بيعمل المصالحة
 *     (قراءة جديدة من السيرفر) في onAbandon، وبعدها بينادي reopen().
 *   • reopen(): abandoned → editing بعد ما المصالحة تخلص بس.
 *   • resetAfterSuccess(): done → editing لو النموذج لسه مفتوح بعد النجاح.
 */
export function useInventoryIntent<P, R>(
  send: (commandId: string, payload: P) => Promise<InventoryResult<R>>,
  handlers: { onDone: (data: R) => void; onAbandon: () => void },
) {
  const [intent, setIntentState] = useState<IntentState<P>>(() => initialIntent<P>())
  const intentRef = useRef(intent)
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
    const next = settleIntent(intentRef.current, commandId, outcome)
    set(next)
    if (next.phase === 'done' && data !== null) handlersRef.current.onDone(data.value)
  }

  function begin(payload: P): boolean {
    const next = beginIntent(intentRef.current, payload, crypto.randomUUID())
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

  function reopen() {
    const next = reopenAfterReconcile(intentRef.current)
    if (next !== null) set(next)
  }

  function resetAfterSuccess() {
    const next = resetAfterDone(intentRef.current)
    if (next !== null) set(next)
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
    reopen,
    resetAfterSuccess,
    edit,
    canEdit: canEditPayload(intent),
    risky: isLeaveRisky(intent),
  }
}
