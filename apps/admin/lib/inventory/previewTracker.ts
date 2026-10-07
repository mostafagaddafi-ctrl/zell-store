/**
 * ربط المعاينة ببصمة النموذج — منطق خالص (ملاحظة المراجعة على عقد PR-D).
 *
 *   • كل طلب معاينة بياخد تذكرة: رقم متزايد + بصمة الـpayload اللي اتعاين.
 *   • الرد بيتقبل بس لو تذكرته هي **آخر** طلب، وبصمتها = بصمة النموذج **الحالية**.
 *     → رد قديم بعد تعديل النموذج بيتهمل، ورد طلب أول بيوصل بعد طلب تاني بيتهمل.
 * البصمة = JSON بتاع الـpayload المطبّع (build*Payload بيبنيه بترتيب مفاتيح ثابت).
 */

export type PreviewTicket = { requestId: number; fingerprint: string }

export function payloadFingerprint(payload: unknown): string {
  return JSON.stringify(payload)
}

export function nextPreviewTicket(lastRequestId: number, fingerprint: string): PreviewTicket {
  return { requestId: lastRequestId + 1, fingerprint }
}

export function acceptPreviewResult(
  ticket: PreviewTicket,
  latestRequestId: number,
  currentFingerprint: string | null,
): boolean {
  return ticket.requestId === latestRequestId && currentFingerprint !== null && ticket.fingerprint === currentFingerprint
}
