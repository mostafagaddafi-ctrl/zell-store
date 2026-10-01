/**
 * request_hash — ORDER-FLOW-PLAN.md §4.2.
 *
 * الهاش بيغطي **القيم المطبّعة الستة** بالظبط: الاسم · الهاتف · المحافظة ·
 * العنوان · الملاحظات · الأصناف. التطبيع والتمثيل في ./canonical عشان الواجهة
 * تستخدم **نفس** المنطق لربط مفتاح الـidempotency.
 *
 * ⚠️ التغطية الكاملة **شرط صحّة** مش تفصيلة:
 *   • القفل لكل موبايل في zell_create_order كافي *فقط لأن* الهاتف داخل في
 *     الهاش — غير كده طلبين بنفس المفتاح وهاتفين مختلفين بياخدوا قفلين
 *     مختلفين ويقدروا يدوّروا رمز الإيصال بالتوازي.
 *   • الفحوصات الثابتة اللي بعد حسم الـreplay آمنة *فقط لأن* الاسم والعنوان
 *     والملاحظات والأصناف داخلين.
 *
 * أي حقل يُضاف لـOrderRequest لازم يدخل canonicalOrderJson في نفس الـPR.
 *
 * ⚠️ ممنوع receipt_token_hash أو checkout_session_hash يدخلوا الهاش: الرمز
 *    بيتولّد جديد كل محاولة، والجلسة مش من بيانات الطلب.
 */

import { canonicalOrderJson, type NormalizedOrder } from './canonical'
import { sha256Hex } from './hash'

export { canonicalOrderJson, normalizeOrder } from './canonical'
export type { NormalizedOrder } from './canonical'

export async function requestHash(order: NormalizedOrder): Promise<string> {
  return sha256Hex(canonicalOrderJson(order))
}