'use client'

import { useRef, useState } from 'react'
import type { InventoryResult } from '../inventory/errors'
import { acceptPreviewResult, nextPreviewTicket, payloadFingerprint } from '../inventory/previewTracker'

const PREVIEW_FAILED = 'المعاينة فشلت. جرّب تاني.'

/**
 * معاينة التكلفة (قراءة بس) مربوطة ببصمة النموذج (lib/inventory/previewTracker.ts):
 *   • كل run بياخد تذكرة (رقم متزايد + بصمة الـpayload).
 *   • الرد بيتعرض بس لو تذكرته آخر طلب وبصمتها = بصمة النموذج الحالية — رد قديم بعد تعديل، أو طلب
 *     أول بيوصل بعد طلب تاني، بيتهمل.
 *   • النتيجة المعروضة كمان بتتفلتر بالبصمة الحالية وقت الرسم (حماية تانية).
 * currentFingerprint = بصمة الـpayload المبني حاليًا، أو null لو النموذج مش صالح.
 */
export function usePreview<D, R>(action: (doc: D) => Promise<InventoryResult<R>>, currentFingerprint: string | null) {
  const [result, setResult] = useState<{ fingerprint: string; data: R } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const latestRef = useRef(0)
  const fingerprintRef = useRef(currentFingerprint)
  fingerprintRef.current = currentFingerprint
  const actionRef = useRef(action)
  actionRef.current = action

  async function run(doc: D) {
    const ticket = nextPreviewTicket(latestRef.current, payloadFingerprint(doc))
    latestRef.current = ticket.requestId
    setPending(true)
    setError(null)
    let response: InventoryResult<R> | null = null
    try {
      response = await actionRef.current(doc)
    } catch {
      response = null
    }
    if (ticket.requestId !== latestRef.current) return // طلب أحدث شغّال — هو اللي هيقفل pending
    setPending(false)
    if (!acceptPreviewResult(ticket, latestRef.current, fingerprintRef.current)) return
    if (response && response.ok) setResult({ fingerprint: ticket.fingerprint, data: response.data })
    else setError(response && response.code !== 'INTERNAL' ? response.message : PREVIEW_FAILED)
  }

  function reset() {
    latestRef.current += 1 // أي طلب جاري بقى قديم
    setPending(false)
    setResult(null)
    setError(null)
  }

  const preview = result !== null && result.fingerprint === currentFingerprint ? result.data : null
  return { preview, error, previewing: pending, run, reset }
}
