/**
 * ثوابت وأنواع **آمنة للعميل**.
 *
 * الملف ده مقصود يكون خالي من أي استيراد سيرفر، لسببين:
 *   1. مكوّنات الواجهة بتستورد منه قيم فعلية (مش أنواع بس)، ولو كان
 *      في سلسلته أي ملف server-only، البناء بيفشل.
 *   2. طبقة القراءة نفسها بتستورد الثوابت دي — فلو كانت في adminData
 *      كان هيحصل استيراد دائري: adminData ← reads ← rows ← adminData.
 */

export const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'جديد',
  confirmed: 'مؤكد',
  shipped: 'اتشحن',
  delivered: 'اتسلّم',
  cancelled: 'ملغي',
}

/** 0019 — الإلغاء نهائي (trigger orders_cancelled_final · 45080). نفس الرسالة في الواجهة والسيرفر. */
export const ORDER_CANCELLED_FINAL_MESSAGE = 'الطلب ده ملغي، والإلغاء نهائي — مينفعش يرجع لأي حالة تانية.'

/** الحالات اللي ينفع الطلب يتنقل لها من حالته. الملغي مالوش انتقالات. */
export function statusTargets(status: OrderStatus): OrderStatus[] {
  return status === 'cancelled' ? [] : ORDER_STATUSES.filter((item) => item !== status)
}

export const SECTION_KEYS = ['hero', 'products', 'how_it_works', 'faq'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_LABELS: Record<SectionKey, string> = {
  hero: 'الواجهة الرئيسية',
  products: 'المنتجات',
  how_it_works: 'خطوات الطلب',
  faq: 'الأسئلة الشائعة',
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

export type ImageFit = 'cover' | 'contain'
