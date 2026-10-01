/**
 * request_hash — ORDER-FLOW-PLAN.md §4.2.
 *
 * الهاش بيغطي **القيم المطبّعة الستة** بالظبط: الاسم · الهاتف · المحافظة ·
 * العنوان · الملاحظات · الأصناف.
 *
 * ⚠️ التغطية الكاملة دي **شرط صحّة** مش تفصيلة:
 *   • القفل لكل موبايل في zell_create_order كافي *فقط لأن* الهاتف داخل في
 *     الهاش — غير كده طلبين بنفس المفتاح وهاتفين مختلفين بياخدوا قفلين
 *     مختلفين ويقدروا يدوّروا رمز الإيصال بالتوازي.
 *   • الفحوصات الثابتة اللي بعد حسم الـreplay آمنة *فقط لأن* الاسم والعنوان
 *     والملاحظات والأصناف داخلين.
 *
 * أي حقل يُضاف لـOrderRequest لازم يدخل هنا في نفس الـPR.
 *
 * ⚠️ ممنوع receipt_token_hash أو checkout_session_hash يدخلوا الهاش: الرمز
 *    بيتولّد جديد كل محاولة، والجلسة مش من بيانات الطلب.
 */

import { normalizePhone } from '@zell/core'
import type { OrderRequest } from './contracts'
import { sha256Hex } from './hash'

export type NormalizedOrder = {
  customerName: string
  customerPhone: string
  governorate: string
  address: string
  notes: string | null
  items: Array<{ productId: number; lengthCm: number }>
}

/** التطبيع ضروري: لولاه «احمد » و«احمد» يبقوا طلبين مختلفين بنفس المفتاح. */
export function normalizeOrder(input: OrderRequest): NormalizedOrder {
  const notes = (input.notes ?? '').trim()
  const items = input.items
    .map((item) => ({ productId: item.productId, lengthCm: item.lengthCm }))
    .sort((a, b) => a.productId - b.productId || a.lengthCm - b.lengthCm)

  return {
    customerName: input.customerName.trim(),
    customerPhone: normalizePhone(input.customerPhone),
    governorate: input.governorate,
    address: input.address.trim(),
    notes: notes === '' ? null : notes,
    items,
  }
}

/**
 * تمثيل قانوني ثابت. مصفوفة مش كائن **عن قصد**: ترتيب العناصر مضمون بالبنية
 * نفسها، فمفيش اعتماد على ترتيب مفاتيح JSON.stringify.
 */
export function canonicalOrderJson(order: NormalizedOrder): string {
  return JSON.stringify([
    order.customerName,
    order.customerPhone,
    order.governorate,
    order.address,
    order.notes,
    order.items.map((item) => [item.productId, item.lengthCm]),
  ])
}

export async function requestHash(order: NormalizedOrder): Promise<string> {
  return sha256Hex(canonicalOrderJson(order))
}
