import 'server-only'

import { restRpc, sentinelOf, type DbSentinel } from '../data/client'
import { failureFromSentinel, type InventoryResult } from './errors'
import { isInventorySentinel, type InventorySentinel } from './sentinels'

/**
 * غلاف نداء دوال 0020 — سيرفر بس.
 *
 *   • أسماء الدوال ثابتة هنا؛ مفيش اسم دالة بييجي من أي مدخلات.
 *   • p_actor بيتحط من الجلسة في lib/mutations/inventory.ts — عمره ما بييجي من الفورم.
 *   • أي فشل: اسم من قايمة المخزون → جدول الأخطاء، وأي حاجة تانية → INTERNAL غير محسوم.
 *     ولا حرف من رد Supabase بيطلع (client.ts بيرمي الجسم بعد استخراج الاسم).
 *   • رد بشكل غير متوقع → INTERNAL غير محسوم (لأن الكتابة ممكن تكون حصلت فعلًا).
 */

/** إثبات وقت الـtypecheck إن الـ23 اسم متسجلين في KNOWN_SENTINELS (lib/data/client.ts). */
type AssertTrue<T extends true> = T
export type InventorySentinelsRegistered = AssertTrue<[InventorySentinel] extends [DbSentinel] ? true : false>

const FUNCTIONS = {
  listSuppliers: 'zell_inv_list_suppliers',
  createSupplier: 'zell_inv_create_supplier',
  updateSupplier: 'zell_inv_update_supplier',
} as const

export type InventoryFunction = keyof typeof FUNCTIONS

export async function callInventory<T>(
  fn: InventoryFunction,
  args: Record<string, unknown>,
  accept: (value: unknown) => value is T,
): Promise<InventoryResult<T>> {
  let raw: unknown
  try {
    raw = await restRpc<unknown>(FUNCTIONS[fn], args)
  } catch (error) {
    const sentinel = sentinelOf(error)
    return failureFromSentinel(isInventorySentinel(sentinel) ? sentinel : null)
  }
  if (!accept(raw)) return failureFromSentinel(null)
  return { ok: true, data: raw }
}
