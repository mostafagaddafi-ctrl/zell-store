/**
 * قفل كتابة متزامن لكل مستند — منطق خالص (ملاحظة المراجعة على PR #96).
 *
 * المشكلة: كل عملية (حفظ، ترحيل، استبعاد، إبطال) ليها hook مستقل، وstate بتاع React مش قفل فوري.
 * ضغطتين في نفس الـtick (تأكيد مرتين، أو ترحيل واستبعاد مع بعض) كانوا ممكن يبدأوا نيتين بمفتاحين.
 *
 * الحل: قفل واحد بـref على مستوى المستند، بيتحجز **بشكل متزامن قبل** beginIntent:
 *   • startLockedIntent: يحجز القفل ثم يبدأ النية؛ لو أي نية تانية ماسكاه → null (مفيش بدء).
 *   • settleLockedIntent: الرفض الواضح (رجوع لـ editing) بيحرّر القفل؛ غير المحسوم (unresolved)
 *     بيفضل ماسكه (الإعادة بنفس المفتاح بس)؛ النجاح (done) بيفضل ماسكه لحد المصالحة.
 *   • releaseAfterReconcile: بعد ما القراءة الجديدة من السيرفر تخلص: abandoned/done → editing، والقفل
 *     بيتحرر.
 *   • canConfirm: بوابة التأكيد وقت الضغط نفسه، من القيم الحالية (refs) مش من closure قديم.
 */

import {
  beginIntent,
  reopenAfterReconcile,
  resetAfterDone,
  settleIntent,
  type IntentOutcome,
  type IntentState,
} from './intent'

export type WriteLock = {
  holder: () => string | null
  tryAcquire: (owner: string) => boolean
  release: (owner: string) => void
}

export function createWriteLock(): WriteLock {
  let current: string | null = null
  return {
    holder: () => current,
    tryAcquire: (owner) => {
      if (current !== null) return false
      current = owner
      return true
    },
    release: (owner) => {
      if (current === owner) current = null
    },
  }
}

/** بدء نية بعد حجز القفل المشترك. null = ممنوع (النية مش في editing، أو القفل مع عملية تانية). */
export function startLockedIntent<P>(
  lock: WriteLock,
  owner: string,
  state: IntentState<P>,
  payload: P,
  commandId: string,
): IntentState<P> | null {
  if (state.phase !== 'editing') return null
  if (!lock.tryAcquire(owner)) return null
  const next = beginIntent(state, payload, commandId)
  if (next === null) {
    lock.release(owner)
    return null
  }
  return next
}

/** تسوية نتيجة الإرسال؛ الرفض الواضح بيحرّر القفل. أي نتيجة قديمة (مفتاح تاني) مابتلمسش القفل. */
export function settleLockedIntent<P>(
  lock: WriteLock,
  owner: string,
  state: IntentState<P>,
  commandId: string,
  outcome: IntentOutcome,
): IntentState<P> {
  const next = settleIntent(state, commandId, outcome)
  if (state.phase === 'submitting' && next.phase === 'editing') lock.release(owner)
  return next
}

/** بعد المصالحة: abandoned → editing أو done → editing، والقفل بيتحرر. غير كده الحالة زي ما هي. */
export function releaseAfterReconcile<P>(lock: WriteLock, owner: string, state: IntentState<P>): IntentState<P> {
  const reopened = reopenAfterReconcile(state) ?? resetAfterDone(state)
  if (reopened === null) return state
  lock.release(owner)
  return reopened
}

export type ConfirmGate = {
  mutationsOn: boolean
  reconciling: boolean
  lockHolder: string | null
  /** سبب منع العملية دي بالذات (مثلًا تعديلات مش محفوظة قبل الترحيل)، أو null. */
  blockedReason: string | null
}

export function canConfirm(gate: ConfirmGate): boolean {
  return gate.mutationsOn && !gate.reconciling && gate.lockHolder === null && gate.blockedReason === null
}
