import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { authCredentials } from '../auth/env'
import { createAuthClient } from '../auth/supabaseServer'
import { restRpc } from '../data/client'
import type { MutationResult } from '../mutations'
import { ORDER_PURGE_MESSAGES, runOrderPurge, sessionIdFromToken, verifyOwnerPassword, type PurgeRequest, type PurgeResult, type TempAuthClient } from '../orders/purge'

/**
 * ORDER-DELETE (المرحلة C) — الحذف (العقد docs/contracts/ORDER-DELETE.md §٥-٣):
 *   1. zell_purge_reauth_begin(actor) بـ service_role: بيقفل عدّاد المالك ويعدّ المحاولة قبل فحص الباسورد.
 *   2. الباسورد عن طريق verifyOwnerPassword (lib/orders/purge.ts، مختبرة بعميل محاكاة): عميل Supabase منفصل من createClient
 *      بخيارات TEMP_AUTH_OPTIONS (من غير كوكيز ولا حفظ جلسة)، وأي جلسة مؤقتة اتعملت بتتلغي (scope: local) قبل أي نتيجة،
 *      ولو الإلغاء فشل أو الهوية مختلفة = مش محسوم = مفيش تذكرة ولا حذف. العميل الأصلي مابيتلمسش.
 *   3. zell_purge_reauth_finish بـ service_role: غلط = مفيش تذكرة · صح = تذكرة دقيقتين لاستعمال واحد، مربوطة بالمالك وبالجلسة
 *      الأصلية (session_id من توكن الجلسة) وبنطاق العملية.
 *   4. zell_purge_orders بجلسة المستخدم والتذكرة. الداتابيز بتفحص المالك والتذكرة والبصمة والعدد تاني.
 * كل خطوة مرة واحدة، ومفيش إعادة تلقائية. لو نتيجة الحذف مش معروفة (شبكة/مهلة): INTERNAL والشاشة بتطلب عرض القايمة من جديد.
 */
const TIMEOUT_MS = 20000

export async function purgeOrders(identity: { userId: string; email: string }, request: PurgeRequest): Promise<MutationResult<PurgeResult>> {
  const supabase = await createAuthClient().catch(() => null)
  if (supabase === null) return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.passwordUnavailable }
  let sessionId: string | null = null
  try {
    const { data } = await supabase.auth.getSession()
    sessionId = sessionIdFromToken(data.session?.access_token, (part) => Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.passwordUnavailable }
  }
  if (sessionId === null || identity.email === '') return { ok: false, code: 'UNAUTHENTICATED', message: ORDER_PURGE_MESSAGES.unauthenticated }
  const session = sessionId

  return runOrderPurge(request, {
    begin: () => restRpc<unknown>('zell_purge_reauth_begin', { p_actor: identity.userId }),
    verifyPassword: () => {
      const { url, anonKey } = authCredentials()
      return verifyOwnerPassword(
        (options) => createClient(url, anonKey, options) as unknown as TempAuthClient,
        identity.email,
        identity.userId,
        request.password,
      )
    },
    finish: (ok: boolean) =>
      restRpc<unknown>('zell_purge_reauth_finish', {
        p_actor: identity.userId,
        p_session: session,
        p_ok: ok,
        p_ids_hash: request.idsHash,
        p_snapshot_hash: request.snapshotHash,
        p_count: request.count,
      }),
    purge: async (ticket: string) => {
      const result = await supabase
        .rpc('zell_purge_orders', { p_ids: request.ids, p_snapshot_hash: request.snapshotHash, p_count: request.count, p_ticket: ticket })
        .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
      return { data: result.data as unknown, error: result.error }
    },
  })
}
