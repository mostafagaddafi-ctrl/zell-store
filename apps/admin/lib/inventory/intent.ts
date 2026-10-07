/**
 * «نية الكتابة» ومفتاح العملية (p_command_id) — state machine خالصة، من غير React ولا شبكة.
 *
 * القواعد (عقد 0020-UI v2 · B3 + ملحق المراجعة):
 *   • المفتاح بيتعمل عند بدء نية محددة **بعد** نجاح التحقق المحلي بس، ومعاه الـpayload بيتجمّد.
 *     التحقق المحلي الفاشل مابيستهلكش مفتاح (beginIntent مابيتناداش أصلًا).
 *   • أثناء submitting و unresolved: الـpayload مقفول (canEditPayload = false).
 *   • نجاح → done. رفض واضح (rejected) → editing، والإرسال الجاي بمفتاح جديد.
 *   • غير محسوم (unresolved: INTERNAL / شبكة / timeout / رد مش مفهوم / 45222) → إعادة بنفس
 *     المفتاح ونفس الـpayload المتجمّد، أو «ترك المحاولة ومراجعة الحالة».
 *   • 45212 (hard) → ممنوع إعادة، والمسار الوحيد مراجعة الحالة.
 *   • «ترك المحاولة» → abandoned: مابيلغيش أي عملية في الداتابيز، ومابيفتحش الـpayload. النموذج
 *     بيتقفل والبيانات بتتقرا من جديد من السيرفر (المصالحة)، وأي تعديل بعد كده نية جديدة من حالة طازة.
 *   • كل عملية (create/update/post/discard/void) نية مستقلة؛ المفتاح مابيتعادش بين عمليتين.
 *
 * المفتاح بيتولّد في الواجهة (crypto.randomUUID) ويتبعت هنا — الدالة نفسها مابتولّدش حاجة عشان
 * تفضل قابلة للاختبار.
 */

import type { MutationErrorCode } from '../mutations'
import type { InventoryResolution } from './errors'
import { isUuid } from './ids'

export type IntentFailure = { code: MutationErrorCode; message: string }

export type IntentState<P> =
  | { phase: 'editing'; failure: IntentFailure | null }
  | { phase: 'submitting'; commandId: string; payload: P; attempt: number }
  | { phase: 'unresolved'; commandId: string; payload: P; attempt: number; hard: boolean; message: string }
  | { phase: 'done'; commandId: string }
  | { phase: 'abandoned' }

/** نتيجة الإرسال كما وصلت للواجهة. thrown = الـaction نفسه رمى (شبكة، timeout، رد مش مفهوم). */
export type IntentOutcome =
  | { ok: true }
  | { ok: false; code: MutationErrorCode; message: string; resolution: InventoryResolution }
  | { thrown: true }

export const NETWORK_UNRESOLVED_MESSAGE =
  'الاتصال وقع قبل ما توصل النتيجة، فمش واضح العملية اتنفذت ولا لأ. أعد نفس المحاولة، أو اتركها وراجع الحالة.'

export const LEAVE_WARNING =
  'في عملية نتيجتها مش واضحة. لو سبت الصفحة أو حدّثتها، مش هتقدر تعيد نفس المحاولة بنفس المفتاح.'

export function initialIntent<P>(): IntentState<P> {
  return { phase: 'editing', failure: null }
}

/** تعديل في الحقول — مسموح في editing بس، وبيشيل آخر رسالة رفض. */
export function editIntent<P>(state: IntentState<P>): IntentState<P> {
  if (state.phase !== 'editing') return state
  return state.failure === null ? state : { phase: 'editing', failure: null }
}

/** بدء نية جديدة. null = ممنوع (مش في editing، أو المفتاح مش UUID). */
export function beginIntent<P>(state: IntentState<P>, payload: P, commandId: string): IntentState<P> | null {
  if (state.phase !== 'editing') return null
  if (!isUuid(commandId)) return null
  return { phase: 'submitting', commandId, payload, attempt: 1 }
}

/** إعادة غير المحسوم بنفس المفتاح ونفس الـpayload. null لو ممنوع (مش unresolved، أو hard). */
export function retryIntent<P>(state: IntentState<P>): IntentState<P> | null {
  if (state.phase !== 'unresolved' || state.hard) return null
  return { phase: 'submitting', commandId: state.commandId, payload: state.payload, attempt: state.attempt + 1 }
}

/**
 * تسوية نتيجة إرسال. أي نتيجة لمفتاح غير المفتاح الجاري (أو بعد ما الحالة اتغيرت) بتتجاهل.
 */
export function settleIntent<P>(state: IntentState<P>, commandId: string, outcome: IntentOutcome): IntentState<P> {
  if (state.phase !== 'submitting' || state.commandId !== commandId) return state

  if ('thrown' in outcome) {
    return {
      phase: 'unresolved',
      commandId: state.commandId,
      payload: state.payload,
      attempt: state.attempt,
      hard: false,
      message: NETWORK_UNRESOLVED_MESSAGE,
    }
  }
  if (outcome.ok) return { phase: 'done', commandId: state.commandId }

  if (outcome.resolution === 'rejected') {
    return { phase: 'editing', failure: { code: outcome.code, message: outcome.message } }
  }
  return {
    phase: 'unresolved',
    commandId: state.commandId,
    payload: state.payload,
    attempt: state.attempt,
    hard: outcome.resolution === 'hard',
    message: outcome.message,
  }
}

/** «ترك المحاولة ومراجعة الحالة» — من unresolved بس. null لو ممنوع. */
export function abandonIntent<P>(state: IntentState<P>): IntentState<P> | null {
  if (state.phase !== 'unresolved') return null
  return { phase: 'abandoned' }
}

/**
 * بعد ما المصالحة تخلص (البيانات اتقرت من جديد من السيرفر): abandoned → editing.
 * null لو الحالة مش abandoned. قبل كده الـpayload بيفضل مقفول.
 */
export function reopenAfterReconcile<P>(state: IntentState<P>): IntentState<P> | null {
  if (state.phase !== 'abandoned') return null
  return initialIntent<P>()
}

/**
 * بعد نجاح عملية والنموذج لسه مفتوح (والبيانات اتقرت من جديد): done → editing، والإرسال الجاي بنية
 * ومفتاح جديد. null لو الحالة مش done.
 */
export function resetAfterDone<P>(state: IntentState<P>): IntentState<P> | null {
  if (state.phase !== 'done') return null
  return initialIntent<P>()
}

export function canEditPayload<P>(state: IntentState<P>): boolean {
  return state.phase === 'editing'
}

/** مغادرة الصفحة دلوقتي بتضيّع حاجة؟ (إرسال جاري أو نتيجة غير محسومة) */
export function isLeaveRisky<P>(state: IntentState<P>): boolean {
  return state.phase === 'submitting' || state.phase === 'unresolved'
}
