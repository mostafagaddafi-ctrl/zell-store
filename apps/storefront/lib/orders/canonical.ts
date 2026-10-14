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

import { normalizeCouponCode, normalizePhone, type PreferredDelivery, type ShippingMethod } from '@zell/core'
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
  /** 0018 — null = مفيش منطقة. */
  area: string | null
  /** 0018 — فني تركيب بالسعر. */
  installation: boolean
  /** 0019 — الكود بعد normalizeCouponCode؛ null = مفيش كوبون. */
  couponCode: string | null
  /** 0021-D — الموعد المفضّل (null = مفيش). */
  preferredDelivery: PreferredDelivery | null
  /** EXPRESS-SHIPPING — 'standard' لو مفيش اختيار. */
  shippingMethod: ShippingMethod
  items: Array<{ productId: number; lengthCm?: number; widthCm?: number; quantity?: number }>
}

/**
 * التطبيع ضروري: لولاه «احمد » و«احمد» يبقوا طلبين مختلفين بنفس المفتاح.
 * الستة كلهم بيتطبّعوا — ولا واحد بيفضل خام.
 */
export function normalizeOrder(input: OrderRequest): NormalizedOrder {
  const notes = normalizeText(input.notes ?? '')
  const area = normalizeText(input.area ?? '')
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
    area: area === '' ? null : area,
    installation: input.installation === true,
    // 0019 — فاضي = null. الراوت بيرفض غير الصالح (COUPON_INVALID) قبل ما يوصل هنا
    couponCode: normalizeCouponCode(input.couponCode),
    preferredDelivery:
      input.preferredDelivery === undefined || input.preferredDelivery === null
        ? null
        : {
            date: input.preferredDelivery.date,
            period: input.preferredDelivery.period,
            note: input.preferredDelivery.note === null ? null : normalizeText(input.preferredDelivery.note) || null,
          },
    // EXPRESS-SHIPPING — 'express' بس لو مبعوت صراحة؛ غير كده عادي
    shippingMethod: input.shippingMethod === 'express' ? 'express' : 'standard',
    items,
  }
}

/**
 * تمثيل ثابت. مصفوفة مش كائن **عن قصد**: ترتيب العناصر مضمون بالبنية نفسها،
 * فمفيش اعتماد على ترتيب مفاتيح JSON.stringify.
 */
export function canonicalOrderJson(order: NormalizedOrder): string {
  const shape: unknown[] = [
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
  ]
  // 0018 — منطقة أو فني: عنصر سابع بعلامة 'v2'. من غيرهم الصيغة القديمة بالحرف،
  // فمفاتيح الـidempotency اللي في sessionStorage للطلبات العادية مابتتغيرش.
  if (order.area !== null || order.installation) shape.push(['v2', order.area ?? '', order.installation ? 1 : 0])
  // 0019 — كوبون: عنصر بعلامة 'c1' بعد 'v2' (لو موجود). من غير كوبون الصيغة اللي فوق بالحرف،
  // وتغيير الكود أو شيله = canonical جديد = مفتاح جديد (مش IDEMPOTENCY_MISMATCH).
  if (order.couponCode !== null) shape.push(['c1', order.couponCode])
  // 0021-D — بس لو موجود: من غير موعد = الشكل القديم بالحرف، وبموعد = هاش جديد (مفتاح idempotency جديد)
  if (order.preferredDelivery !== null) {
    shape.push(['d1', order.preferredDelivery.date, order.preferredDelivery.period ?? '', order.preferredDelivery.note ?? ''])
  }
  // EXPRESS-SHIPPING — بس لو سريع: عنصر ['s1', 'express'] في الآخر. العادي = الشكل القديم بالحرف (نفس الهاش ونفس مفاتيح
  // الـ idempotency)، وتغيير الطريقة = canonical جديد = مفتاح جديد (مش IDEMPOTENCY_MISMATCH).
  if (order.shippingMethod === 'express') shape.push(['s1', 'express'])
  return JSON.stringify(shape)
}