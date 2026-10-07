/**
 * جدول أخطاء المخزون — منطق خالص (من غير server-only): السيرفر بيبني بيه النتيجة، والواجهة
 * والاختبارات بيقروه.
 *
 * كل نتيجة فشل ليها resolution بيحدد مصير «نية الكتابة» (lib/inventory/intent.ts):
 *   • rejected   — رفض واضح: العملية ماتنفذتش. النية بتخلص والنموذج بيرجع للتعديل.
 *   • unresolved — مش معروف اتنفذت ولا لأ (INTERNAL / شبكة / 45222). إعادة بنفس المفتاح بس.
 *   • hard       — 45212: نفس المفتاح متسجّل بمعنى تاني. ممنوع إعادة وممنوع مفتاح جديد قبل المصالحة.
 *
 * ⚠️ 45203 (ZELL_INV_INVALID) رسالة عامة — مفيش details بتعدّي (قرار المراجعة: الاختيار «أ»).
 */

import type { MutationErrorCode } from '../mutations'
import type { InventorySentinel } from './sentinels'

export type InventoryResolution = 'rejected' | 'unresolved' | 'hard'

export type InventoryFailure = {
  ok: false
  code: MutationErrorCode
  message: string
  resolution: InventoryResolution
}

export type InventoryResult<T> = { ok: true; data: T } | InventoryFailure

export type InventoryErrorCategory = 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION'

type InventoryErrorEntry = {
  category: InventoryErrorCategory
  message: string
  resolution: InventoryResolution
}

export const INVENTORY_ERRORS: Readonly<Record<InventorySentinel, InventoryErrorEntry>> = {
  ZELL_INV_FORBIDDEN: {
    category: 'FORBIDDEN',
    message: 'الحساب ده مش مصرّح له بإدارة المخزون.',
    resolution: 'rejected',
  },
  ZELL_INV_NOT_FOUND: { category: 'NOT_FOUND', message: 'السجل مش موجود.', resolution: 'rejected' },
  ZELL_INV_CONFLICT: {
    category: 'CONFLICT',
    message: 'السجل اتغيّر من مكان تاني. اعمل تحديث وراجع قبل ما تحفظ تاني.',
    resolution: 'rejected',
  },
  ZELL_INV_INVALID: {
    category: 'VALIDATION',
    message: 'في بيانات غير صالحة. راجع الحقول.',
    resolution: 'rejected',
  },
  ZELL_INV_SUPPLIER_INACTIVE: { category: 'VALIDATION', message: 'المورد ده موقوف.', resolution: 'rejected' },
  ZELL_INV_LOCATION_INACTIVE: { category: 'VALIDATION', message: 'المخزن ده موقوف.', resolution: 'rejected' },
  ZELL_INV_PRODUCT_UNIT: {
    category: 'VALIDATION',
    message: 'نوع البند مش مناسب لوحدة بيع المنتج (اللفّات للمتر، والقطع للعدد).',
    resolution: 'rejected',
  },
  ZELL_INV_WIDTH_NOT_ALLOWED: {
    category: 'VALIDATION',
    message: 'العرض ده مش من عروض المنتج المسموحة.',
    resolution: 'rejected',
  },
  ZELL_INV_NOT_DRAFT: {
    category: 'CONFLICT',
    message: 'المستند مبقاش مسودة. اعمل تحديث وشوف حالته.',
    resolution: 'rejected',
  },
  ZELL_INV_EMPTY: { category: 'VALIDATION', message: 'لازم بند واحد على الأقل.', resolution: 'rejected' },
  ZELL_INV_ALLOCATION_BASE_ZERO: {
    category: 'VALIDATION',
    message: 'مينفعش توزيع المصاريف أو الخصم وإجمالي البنود صفر.',
    resolution: 'rejected',
  },
  ZELL_INV_DISCOUNT_TOO_LARGE: {
    category: 'VALIDATION',
    message: 'خصم المورد أكبر من المسموح.',
    resolution: 'rejected',
  },
  ZELL_INV_COMMAND_MISMATCH: {
    category: 'CONFLICT',
    message:
      'المحاولة دي متسجّلة قبل كده ببيانات مختلفة، وممكن عملية قديمة تكون نجحت. حدّث الصفحة وراجع الحالة قبل أي محاولة جديدة.',
    resolution: 'hard',
  },
  ZELL_INV_HAS_DEPENDENCIES: {
    category: 'CONFLICT',
    message: 'مينفعش: في حركات مرتبطة بالسجل ده.',
    resolution: 'rejected',
  },
  ZELL_INV_NOT_POSTED: {
    category: 'CONFLICT',
    message: 'المستند مش مرحّل. اعمل تحديث وشوف حالته.',
    resolution: 'rejected',
  },
  ZELL_INV_ZERO_COST_RULE: {
    category: 'VALIDATION',
    message: 'البند اللي تكلفته صفر محتاج سبب.',
    resolution: 'rejected',
  },
  ZELL_INV_IMMUTABLE: {
    category: 'CONFLICT',
    message: 'السجل ده مقفول ومينفعش يتعدل.',
    resolution: 'rejected',
  },
  ZELL_INV_SALE_UNIT_LOCKED: {
    category: 'CONFLICT',
    message: 'وحدة البيع اتقفلت لأن المنتج عليه مخزون أو مستندات مخزون.',
    resolution: 'rejected',
  },
  ZELL_INV_SUPPLIER_NAME_TAKEN: {
    category: 'VALIDATION',
    message: 'اسم المورد ده موجود قبل كده.',
    resolution: 'rejected',
  },
  ZELL_INV_LOCATION_CODE_TAKEN: {
    category: 'VALIDATION',
    message: 'كود المخزن ده موجود قبل كده.',
    resolution: 'rejected',
  },
  ZELL_INV_MAIN_LOCKED: {
    category: 'VALIDATION',
    message: 'المخزن الرئيسي مينفعش يتوقف أو يتغيّر.',
    resolution: 'rejected',
  },
  ZELL_INV_DATE_IN_FUTURE: {
    category: 'VALIDATION',
    message: 'التاريخ مينفعش يكون في المستقبل.',
    resolution: 'rejected',
  },
  ZELL_INV_COMMAND_RACE: {
    category: 'CONFLICT',
    message: 'نفس العملية لسه شغالة. استنى ثواني وأعد نفس المحاولة.',
    resolution: 'unresolved',
  },
}

export const INVENTORY_UNRESOLVED_MESSAGE =
  'مش واضح العملية اتنفذت ولا لأ. أعد نفس المحاولة، أو اتركها وراجع الحالة الأول.'

export const INVENTORY_OWNER_ONLY_MESSAGE = 'إدارة المخزون للمالك بس.'

export const COMMAND_ID_MESSAGE = 'مفتاح العملية غير صالح. حدّث الصفحة وابدأ من جديد.'

/** اسم معروف → النتيجة من الجدول. null (أي فشل تاني) → INTERNAL غير محسوم. */
export function failureFromSentinel(sentinel: InventorySentinel | null): InventoryFailure {
  if (sentinel === null) {
    return { ok: false, code: 'INTERNAL', message: INVENTORY_UNRESOLVED_MESSAGE, resolution: 'unresolved' }
  }
  const entry = INVENTORY_ERRORS[sentinel]
  return { ok: false, code: entry.category, message: entry.message, resolution: entry.resolution }
}

/**
 * فشل قبل أي نداء للداتابيز (جلسة، صلاحية، علم الجاهزية، تحقق) — العملية أكيد ماتنفذتش.
 */
export function rejectedFailure(failure: { code: MutationErrorCode; message: string }): InventoryFailure {
  return { ok: false, code: failure.code, message: failure.message, resolution: 'rejected' }
}

export function validationFailure(message: string): InventoryFailure {
  return rejectedFailure({ code: 'VALIDATION', message })
}
