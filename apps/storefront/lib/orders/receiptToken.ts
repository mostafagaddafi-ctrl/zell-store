/**
 * رمز الإيصال — ORDER-FLOW-PLAN.md §6.1 و§6.4.
 *
 * 🔒 السر الخام:
 *   • عمره ما يدخل الداتابيز — الهاش بس.
 *   • عمره ما يترجع في JSON — Set-Cookie بس.
 *   • عمره ما يدخل URL — الكوكي HttpOnly ومقيّدة بمسار الطلب.
 */

import { randomBase64Url, sha256Hex } from './hash'

/** ٧ أيام — نفس c_receipt_days في 0006b. بتتكتب مرة واحدة وما بتتمدّش. */
export const RECEIPT_MAX_AGE_SECONDS = 604800

/** اسم الكوكي فيه رقم الطلب حرفياً بالشرطة (ب١٢). */
export function receiptCookieName(orderNumber: string): string {
  return 'zell_rcpt_' + orderNumber
}

export function receiptCookiePath(orderNumber: string): string {
  return '/order/' + orderNumber
}

export function newReceiptSecret(): string {
  return randomBase64Url(32)
}

export async function receiptTokenHash(secret: string): Promise<string> {
  return sha256Hex(secret)
}
