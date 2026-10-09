/**
 * ثوابت وأنواع **آمنة للعميل**.
 *
 * الملف ده مقصود يكون خالي من أي استيراد سيرفر، لسببين:
 *   1. مكوّنات الواجهة بتستورد منه قيم فعلية (مش أنواع بس)، ولو كان
 *      في سلسلته أي ملف server-only، البناء بيفشل.
 *   2. طبقة القراءة نفسها بتستورد الثوابت دي — فلو كانت في adminData
 *      كان هيحصل استيراد دائري: adminData ← reads ← rows ← adminData.
 */

import { ORDER_STATUSES as CORE_ORDER_STATUSES, STATUS_LABELS, type OrderStatus as CoreOrderStatus } from '@zell/core'

/**
 * 0021-A A2 — الحالات وأسماؤها من @zell/core (مصدر واحد للوحة والمتجر). preparing و refused بيظهروا في العرض،
 * والانتقال ليهم ورا البوابة (lib/orders/cycle.ts + الداتابيز).
 */
export const ORDER_STATUSES = CORE_ORDER_STATUSES
export type OrderStatus = CoreOrderStatus

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = STATUS_LABELS

/** 0019 — الإلغاء نهائي (trigger orders_cancelled_final · 45080). نفس الرسالة في الواجهة والسيرفر. */
export const ORDER_CANCELLED_FINAL_MESSAGE = 'الطلب ده ملغي، والإلغاء نهائي — مينفعش يرجع لأي حالة تانية.'

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
