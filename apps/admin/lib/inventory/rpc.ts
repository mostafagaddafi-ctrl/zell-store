import 'server-only'

import { createAuthClient } from '../auth/supabaseServer'
import { failureFromSentinel, type InventoryResult } from './errors'
import { INVENTORY_SESSION_FUNCTIONS, sessionResult, type InventoryFunction, type SessionRpcResponse } from './sessionCall'

/**
 * غلاف نداء دوال المخزون — سيرفر بس. من 0020-S PR-2: بجلسة المستخدم (createAuthClient: anon key + كوكيز الجلسة)
 * على zell_inv_session_* بس. ممنوع service_role (scripts/check-inventory-session.mjs في CI).
 *
 *   • أسماء الدوال ثابتة في sessionCall.ts؛ مفيش اسم دالة بييجي من أي مدخلات.
 *   • الممثل = sub من JWT الجلسة جوه الداتابيز (zell_inv_claims_actor)، ومفيش أي معامل ممثل من الكود ولا من الفورم.
 *   • الغلاف (actionWithAccess / pageWithAccess) بيفضل الطبقة الأولى زي ما هو.
 *   • أي فشل: اسم من قايمة المخزون → جدول الأخطاء، 401 → UNAUTHENTICATED، وأي حاجة تانية → INTERNAL غير محسوم.
 *   • رد بشكل غير متوقع → INTERNAL غير محسوم (لأن الكتابة ممكن تكون حصلت فعلًا).
 */

const TIMEOUT_MS = 10000

export type { InventoryFunction } from './sessionCall'

export async function callInventory<T>(
  fn: InventoryFunction,
  args: Record<string, unknown>,
  accept: (value: unknown) => value is T,
): Promise<InventoryResult<T>> {
  return callInventoryWith(fn, args, (value) => (accept(value) ? value : null))
}

/**
 * نفس callInventory، بس بمحوّل بيرجّع النسخة المطبّعة من الرد (أو null لو الشكل غلط) — زي
 * parsePurchaseDetail اللي بيطبّع الـdraftPayload.
 */
export async function callInventoryWith<T>(
  fn: InventoryFunction,
  args: Record<string, unknown>,
  parse: (value: unknown) => T | null,
): Promise<InventoryResult<T>> {
  let response: SessionRpcResponse
  try {
    const supabase = await createAuthClient()
    const result = await supabase
      .rpc(INVENTORY_SESSION_FUNCTIONS[fn], args)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    response = { data: result.data as unknown, error: result.error, status: result.status }
  } catch {
    return failureFromSentinel(null)
  }
  return sessionResult(response, parse)
}
