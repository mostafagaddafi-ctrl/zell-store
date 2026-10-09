/**
 * 0020-S PR-2 — نداء المخزون بجلسة المستخدم: الأسماء وتحويل الرد. منطق خالص (من غير server-only)، فالاختبارات
 * (session.cases.ts) والفاحص (scripts/check-inventory-session.mjs) بيقروه.
 *
 *   • الأسماء zell_inv_session_* بس (عقد 0020-S §٣). الممثل = sub من JWT الجلسة جوه الداتابيز، ومفيش أي معامل ممثل.
 *   • المطابقة زي lib/data/client.ts بالحرف: حقل message (ولو مش نص، details)، الاسم كامل أو بادئة «CODE:»،
 *     ومن قايمة المخزون المقفولة بس. ولا حرف من رد Supabase بيطلع برّه الملف ده.
 *   • 401 من PostgREST (جلسة منتهية أو مفيش JWT) = UNAUTHENTICATED بنفس رسالة الغلاف، والعملية أكيد ماتنفذتش.
 *   • أي فشل تاني = INTERNAL غير محسوم، زي قبل PR-2 بالظبط.
 */

import { failureFromSentinel, rejectedFailure, type InventoryResult } from './errors'
import { INVENTORY_SENTINELS, type InventorySentinel } from './sentinels'

export const INVENTORY_SESSION_FUNCTIONS = {
  listSuppliers: 'zell_inv_session_list_suppliers',
  createSupplier: 'zell_inv_session_create_supplier',
  updateSupplier: 'zell_inv_session_update_supplier',
  listLocations: 'zell_inv_session_list_locations',
  listPurchases: 'zell_inv_session_list_purchases',
  getPurchase: 'zell_inv_session_get_purchase',
  previewPurchase: 'zell_inv_session_preview_purchase',
  createPurchase: 'zell_inv_session_create_purchase',
  updatePurchase: 'zell_inv_session_update_purchase',
  postPurchase: 'zell_inv_session_post_purchase',
  discardPurchase: 'zell_inv_session_discard_purchase',
  voidPurchase: 'zell_inv_session_void_purchase',
  listOpenings: 'zell_inv_session_list_openings',
  getOpening: 'zell_inv_session_get_opening',
  previewOpening: 'zell_inv_session_preview_opening',
  createOpening: 'zell_inv_session_create_opening',
  updateOpening: 'zell_inv_session_update_opening',
  postOpening: 'zell_inv_session_post_opening',
  discardOpening: 'zell_inv_session_discard_opening',
  voidOpening: 'zell_inv_session_void_opening',
  listLots: 'zell_inv_session_list_lots',
} as const

export type InventoryFunction = keyof typeof INVENTORY_SESSION_FUNCTIONS

/** نفس UNAUTHENTICATED_MESSAGE في lib/access/wrappers.ts بالحرف (الفاحص بيقارنهم). */
export const SESSION_UNAUTHENTICATED_MESSAGE = 'لازم تسجّل دخول الأول.'

/** الأجزاء الوحيدة اللي بنبصّ فيها من رد supabase-js. */
export type SessionRpcResponse = { data: unknown; error: unknown; status: number }

/** اسم معروف من قايمة المخزون لو الفشل كان واحد منهم، وإلا null. */
export function sentinelFromSessionError(error: unknown): InventorySentinel | null {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null
  const payload = error as { message?: unknown; details?: unknown }
  const candidate =
    typeof payload.message === 'string'
      ? payload.message
      : typeof payload.details === 'string'
        ? payload.details
        : ''
  if (candidate === '') return null
  for (const code of INVENTORY_SENTINELS) {
    if (candidate === code) return code
    if (candidate.startsWith(code + ':')) return code
  }
  return null
}

export function sessionResult<T>(response: SessionRpcResponse, parse: (value: unknown) => T | null): InventoryResult<T> {
  if (response.error !== null && response.error !== undefined) {
    const sentinel = sentinelFromSessionError(response.error)
    if (sentinel !== null) return failureFromSentinel(sentinel)
    if (response.status === 401) {
      return rejectedFailure({ code: 'UNAUTHENTICATED', message: SESSION_UNAUTHENTICATED_MESSAGE })
    }
    return failureFromSentinel(null)
  }
  const parsed = parse(response.data)
  if (parsed === null) return failureFromSentinel(null)
  return { ok: true, data: parsed }
}
