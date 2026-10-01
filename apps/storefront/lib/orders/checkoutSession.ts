/**
 * كوكي جلسة الدفع zell_ck — ORDER-FLOW-PLAN.md §4.5 (ب١٠).
 *
 * إثبات «المتصفح ده». بيتصدر من الـmiddleware على /checkout **قبل أول submit**،
 * وهاشه بيتخزّن في orders.checkout_session_hash وقت إنشاء الطلب.
 *
 * ⚠️ المسار '/' عن قصد: الكوكي لازم توصل لـPOST /api/orders كمان، مش /checkout
 *    بس. لو المسار بقى '/checkout' الراوت مش هيشوفها وكل submit هيرجع
 *    CHECKOUT_SESSION_MISSING.
 */

import { randomBase64Url, sha256Hex } from './hash'

export const CHECKOUT_SESSION_COOKIE = 'zell_ck'

/** يوم واحد: أطول من أي جلسة شراء واقعية، وأقصر من نافذة الإيصال. */
export const CHECKOUT_SESSION_MAX_AGE_SECONDS = 86400

export function newCheckoutSessionSecret(): string {
  return randomBase64Url(32)
}

export async function checkoutSessionHash(secret: string): Promise<string> {
  return sha256Hex(secret)
}
