import 'server-only'

import { createAuthClient } from '../auth/supabaseServer'
import { ORDER_PURGE_MESSAGES, parsePurgePreview, purgeFailure, validIds, type PurgePreviewResult } from '../orders/purge'

/**
 * ORDER-DELETE (المرحلة C) — معاينة الحذف (zell_purge_preview، 0024) بجلسة المستخدم: anon key + كوكيز الجلسة، من غير service_role
 * ولا معامل ممثل. المالك بس (القرار في الداتابيز). ids = null = كل الطلبات الموجودة لحظتها. الشاشة بتعرض اللي رجع بالحرف
 * ومابتحسبش البصمة.
 */
const TIMEOUT_MS = 15000

export async function readOrderPurgePreview(ids: number[] | null): Promise<PurgePreviewResult> {
  if (ids !== null && !validIds(ids)) return { ok: false, code: 'VALIDATION', message: ORDER_PURGE_MESSAGES.invalid }
  try {
    const supabase = await createAuthClient()
    const result = await supabase.rpc('zell_purge_preview', { p_ids: ids }).abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    if (result.error !== null) {
      const failure = purgeFailure(result.error)
      return { ok: false, code: failure.code, message: failure.code === 'INTERNAL' ? ORDER_PURGE_MESSAGES.previewUnavailable : failure.message }
    }
    const preview = parsePurgePreview(result.data as unknown)
    if (preview === null) return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.previewUnavailable }
    if (ids !== null && (preview.count !== ids.length || preview.ids.some((id, i) => id !== ids[i]))) {
      return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.previewUnavailable }
    }
    return { ok: true, data: preview }
  } catch {
    return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.previewUnavailable }
  }
}
