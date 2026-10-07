/**
 * المصطلحات العربية الثابتة لواجهة المخزون (عقد 0020-UI v2 · B6).
 *
 * 🔒 discarded = «مستبعَد» (مسودة اتشالت قبل الترحيل) ≠ voided = «مُبطَل» (مستند مرحّل اتبطل).
 * 🔒 كلمة «ملغي» ممنوعة في كل واجهة المخزون — الاختبارات بتفحص كل النصوص هنا وفي جدول الأخطاء.
 */

export type InventoryDocStatus = 'draft' | 'posted' | 'discarded' | 'voided'
export type InventoryLotStatus = 'active' | 'voided'

export const DOC_STATUS_LABELS: Readonly<Record<InventoryDocStatus, string>> = {
  draft: 'مسودة',
  posted: 'مرحّل',
  discarded: 'مستبعَد (مسودة)',
  voided: 'مُبطَل',
}

export const LOT_STATUS_LABELS: Readonly<Record<InventoryLotStatus, string>> = {
  active: 'فعّالة',
  voided: 'مُبطَلة',
}

export const DOC_ACTION_LABELS = {
  post: 'ترحيل',
  discard: 'استبعاد المسودة',
  void: 'إبطال المستند المرحّل',
} as const

export const SUPPLIER_STATUS_LABELS = {
  active: 'نشط',
  inactive: 'موقوف',
} as const

export const INTENT_LABELS = {
  retry: 'إعادة نفس المحاولة',
  abandon: 'ترك المحاولة ومراجعة الحالة',
  reconcile: 'تحديث ومراجعة الحالة',
  close: 'قفل',
} as const

/** كل النصوص اللي بتظهر للمستخدم من الملف ده — للاختبار. */
export function allInventoryLabels(): string[] {
  return [
    ...Object.values(DOC_STATUS_LABELS),
    ...Object.values(LOT_STATUS_LABELS),
    ...Object.values(DOC_ACTION_LABELS),
    ...Object.values(SUPPLIER_STATUS_LABELS),
    ...Object.values(INTENT_LABELS),
  ]
}

/** الصيغ الممنوعة. */
export const FORBIDDEN_WORDS = ['ملغي', 'ملغى', 'ملغية', 'ملغاة'] as const
