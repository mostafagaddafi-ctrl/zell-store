/**
 * الصيغة القانونية للطلب — ORDER-FLOW-PLAN.md §4.2.
 *
 * الملف ده **خالص** (مفيش crypto ولا متغيرات بيئة ولا server-only) عشان
 * الواجهة والسيرفر يستخدموا **نفس** المنطق بالحرف:
 *   • السيرفر بيهش الناتج ده → request_hash.
 *   • الواجهة بتربط مفتاح الـidempotency بنفس الناتج.
 *
 * ⚠️ لو الاتنين اختلفوا، تعديل شكلي (مسافة في الاسم) بيولّد مفتاح جديد لنفس
 *    النية — فأول إرسال نجح وضاع رده يتحوّل لطلب تاني بدل replay.
 */

import { normalizePhone } from '@zell/core'
import type { OrderRequest } from './contracts'

/**
 * تطبيع Unicode قبل أي مقارنة أو هاش.
 *
 * ⚠️ نص عربي ملزوق من مصدر بيستخدم NFD بيدّي بايتات مختلفة عن نفس النص في
 *    NFC، فالهاش يختلف والمفتاح يتجدد لنفس النية. NFC الأول ثم trim — مش
 *    العكس: التطبيع ممكن يغيّر محارف المسافات على الأطراف.
 */
function normalizeText(value: string): string {
  return value.normalize('NFC').trim()
}

export type NormalizedOrder = {
  customerName: string
  customerPhone: string
  governorate: string
  address: string
  notes: string | null
  items: Array<{ productId: number; lengthCm?: number; widthCm?: number; quantity?: number }>
}

/**
 * التطبيع ضروري: لولاه «احمد » و«احمد» يبقوا طلبين مختلفين بنفس المفتاح.
 * الستة كلهم بيتطبّعوا — ولا واحد بيفضل خام.
 */
export function normalizeOrder(input: OrderRequest): NormalizedOrder {
  const notes = normalizeText(input.notes ?? '')
  const items = input.items
    .map((item): { productId: number; lengthCm?: number; widthCm?: number; quantity?: number } =>
      item.quantity !== undefined
        ? { productId: item.productId, quantity: item.quantity }
        : item.widthCm === undefined
          ? { productId: item.productId, lengthCm: item.lengthCm ?? 0 }
          : { productId: item.productId, lengthCm: item.lengthCm ?? 0, widthCm: item.widthCm },
    )
    .sort(
      (a, b) =>
        a.productId - b.productId ||
        (a.lengthCm ?? 0) - (b.lengthCm ?? 0) ||
        (a.widthCm ?? 0) - (b.widthCm ?? 0) ||
        (a.quantity ?? 0) - (b.quantity ?? 0),
    )

  return {
    customerName: normalizeText(input.customerName),
    // الهاتف تحت normalizePhone بس — بيشيل كل حاجة مش رقم أصلاً
    customerPhone: normalizePhone(input.customerPhone),
    governorate: normalizeText(input.governorate),
    address: normalizeText(input.address),
    notes: notes === '' ? null : notes,
    items,
  }
}

/**
 * تمثيل ثابت. مصفوفة مش كائن **عن قصد**: ترتيب العناصر مضمون بالبنية نفسها،
 * فمفيش اعتماد على ترتيب مفاتيح JSON.stringify.
 */
export function canonicalOrderJson(order: NormalizedOrder): string {
  return JSON.stringify([
    order.customerName,
    order.customerPhone,
    order.governorate,
    order.address,
    order.notes,
    // 0015 — الصنف من غير عرض بيفضل بنفس الشكل القديم بالظبط
    // 0016 — القطعة بعلامة 'q' عشان ماتتلخبطش مع [منتج، طول، عرض]
    order.items.map((item) =>
      item.quantity !== undefined
        ? [item.productId, 'q', item.quantity]
        : item.widthCm === undefined
          ? [item.productId, item.lengthCm ?? 0]
          : [item.productId, item.lengthCm ?? 0, item.widthCm],
    ),
  ])
}