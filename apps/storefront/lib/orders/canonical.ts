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
  items: Array<{ productId: number; lengthCm: number }>
}

/**
 * التطبيع ضروري: لولاه «احمد » و«احمد» يبقوا طلبين مختلفين بنفس المفتاح.
 * الستة كلهم بيتطبّعوا — ولا واحد بيفضل خام.
 */
export function normalizeOrder(input: OrderRequest): NormalizedOrder {
  const notes = normalizeText(input.notes ?? '')
  const items = input.items
    .map((item) => ({ productId: item.productId, lengthCm: item.lengthCm }))
    .sort((a, b) => a.productId - b.productId || a.lengthCm - b.lengthCm)

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
    order.items.map((item) => [item.productId, item.lengthCm]),
  ])
}