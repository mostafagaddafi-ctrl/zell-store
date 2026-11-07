/**
 * IMAGE-DELETE (C1) — حذف صورة من منتج. منطق خالص (العقد docs/contracts/IMAGE-DELETE.md §٧).
 *
 * الحذف zell_product_image_delete (0026) بجلسة المستخدم، والقرار النهائي في الداتابيز:
 * المالك بس (45402) · الصورة من صور المنتج ده (45701) · آخر صورة معرض في منتج ظاهر (45702) ·
 * سجل الملف متنظّف (45703) · قفل مشغول أو فشل الفحص الأخير (45704).
 * ملف الصورة مابيتمسحش من التخزين: بيتسجّل في storage_orphans (removed) للتنظيف بعدين (IMAGE-CLEANUP).
 * لو الصورة كانت الرئيسية، أول صورة معرض باقية (sort_order ثم id) بتبقى الرئيسية.
 *
 * نصوص اللوحة الجديدة بالفصحى المبسّطة الرسمية.
 */

import type { MutationErrorCode } from '../mutations'

export type ImageDeleteResult = {
  deletedImageId: string
  promotedImageId: string | null
  orphanRecorded: boolean
}

export const IMAGE_DELETE_TEXT = {
  title: 'حذف الصورة؟',
  message: 'ستُزال الصورة من المنتج. يبقى ملفها في التخزين إلى أن يُنظَّف لاحقًا. لا يمكن التراجع عن هذا الإجراء.',
  primaryNote: 'ستصبح أول صورة متبقية في المعرض هي الصورة الرئيسية.',
  confirm: 'احذف',
  button: 'حذف الصورة',
} as const

export const IMAGE_DELETE_MESSAGES = {
  unauthenticated: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
  forbidden: 'حذف الصور متاح للمالك فقط.',
  notFound: 'الصورة غير موجودة، وربما حُذفت بالفعل. حدّث الصفحة.',
  lastVisible: 'أخفِ المنتج أولًا لحذف آخر صورة.',
  orphanConflict: 'تعذّر حذف الصورة بسبب تعارض في سجل تنظيف الملفات. تواصل مع الدعم الفني.',
  busy: 'يتم تعديل صور هذا المنتج حاليًا. حاول مرة أخرى بعد لحظات.',
  internal: 'تعذّر تأكيد حذف الصورة. حدّث الصفحة وراجع صور المنتج.',
  invalid: 'بيانات الحذف غير صالحة. حدّث الصفحة وحاول مرة أخرى.',
} as const

/** رسالة رفض غلاف اللوحة لـ deleteImageAction (حارس المالك، بصلاحية فئة المالك الموجودة). */
export const IMAGE_DELETE_OWNER_ONLY_MESSAGE = IMAGE_DELETE_MESSAGES.forbidden

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** معرّف bigint: نص أرقام موجب، أو رقم صحيح آمن موجب (jsonb بيرجّعه رقم). أي حاجة تانية = null. */
function idText(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  if (typeof value === 'string') return /^[1-9][0-9]{0,18}$/.test(value) ? value : null
  return null
}

/** مدخلات الحذف قبل أي نداء: id منتج موجب صحيح، ومعرّف صورة نص أرقام موجب (bigint بيتبعت نص). */
export function imageDeleteInputIssue(productId: unknown, imageId: unknown): string | null {
  if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) return IMAGE_DELETE_MESSAGES.invalid
  if (typeof imageId !== 'string' || idText(imageId) === null) return IMAGE_DELETE_MESSAGES.invalid
  return null
}

/** رد zell_product_image_delete. لازم نفس الصورة، والترقية null أو معرّف صالح، والتسجيل boolean. وإلا null. */
export function parseImageDeleteResult(raw: unknown, imageId: string): ImageDeleteResult | null {
  if (!isObj(raw)) return null
  if (idText(raw['deleted_image_id']) !== imageId) return null
  const promotedRaw = raw['promoted_image_id']
  const promoted = promotedRaw === null ? null : idText(promotedRaw)
  if (promotedRaw !== null && promoted === null) return null
  if (promoted === imageId) return null
  if (typeof raw['orphan_recorded'] !== 'boolean') return null
  return { deletedImageId: imageId, promotedImageId: promoted, orphanRecorded: raw['orphan_recorded'] }
}

const SENTINEL_CODES: Readonly<Record<string, string>> = {
  ZELL_ORD_UNAUTHENTICATED: '45400',
  ZELL_ORD_FORBIDDEN: '45401',
  ZELL_ORD_OWNER_ONLY: '45402',
  ZELL_IMAGE_NOT_FOUND: '45701',
  ZELL_IMAGE_LAST_VISIBLE: '45702',
  ZELL_IMAGE_ORPHAN_CONFLICT: '45703',
  ZELL_IMAGE_BUSY: '45704',
}

/** كود الخطأ من رد supabase-js: code بصيغة 45xxx، أو اسم معروف في message. */
export function imageDeleteErrorCode(error: unknown): string | null {
  if (!isObj(error)) return null
  const code = error['code']
  if (typeof code === 'string' && /^45[0-9]{3}$/.test(code)) return code
  const message = error['message']
  if (typeof message === 'string') {
    for (const [name, value] of Object.entries(SENTINEL_CODES)) {
      if (message === name || message.startsWith(name + ':')) return value
    }
  }
  return null
}

export type ImageDeleteFailure = { code: MutationErrorCode; message: string }

/** تحويل خطأ الحذف لنتيجة اللوحة. أي حاجة مش معروفة = INTERNAL من غير تفاصيل (النتيجة ممكن تكون مش معروفة). */
export function imageDeleteFailure(error: unknown, httpStatus: number): ImageDeleteFailure {
  switch (imageDeleteErrorCode(error)) {
    case '45400':
      return { code: 'UNAUTHENTICATED', message: IMAGE_DELETE_MESSAGES.unauthenticated }
    case '45401':
    case '45402':
      return { code: 'FORBIDDEN', message: IMAGE_DELETE_MESSAGES.forbidden }
    case '45701':
      return { code: 'NOT_FOUND', message: IMAGE_DELETE_MESSAGES.notFound }
    case '45702':
      return { code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.lastVisible }
    case '45703':
      return { code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.orphanConflict }
    case '45704':
      return { code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.busy }
    default:
      if (httpStatus === 401) return { code: 'UNAUTHENTICATED', message: IMAGE_DELETE_MESSAGES.unauthenticated }
      return { code: 'INTERNAL', message: IMAGE_DELETE_MESSAGES.internal }
  }
}

/**
 * سبب قفل زرار الحذف في صفحة المنتج، أو null لو متاح. الصور هنا صور المعرض بس (getProduct).
 * ده عرض بس: الداتابيز بتعيد الفحص بعد الأقفال (45402 · 45702).
 */
export function imageDeleteBlock(args: { isOwner: boolean; productActive: boolean; galleryCount: number }): string | null {
  if (!args.isOwner) return IMAGE_DELETE_MESSAGES.forbidden
  if (args.productActive && args.galleryCount <= 1) return IMAGE_DELETE_MESSAGES.lastVisible
  return null
}

/** نص حوار التأكيد: سطر الترقية بيظهر بس لو الصورة رئيسية وفيه صورة معرض تانية تترقّى. */
export function imageDeleteDialogMessage(args: { isPrimary: boolean; galleryCount: number }): string {
  if (args.isPrimary && args.galleryCount > 1) return IMAGE_DELETE_TEXT.message + ' ' + IMAGE_DELETE_TEXT.primaryNote
  return IMAGE_DELETE_TEXT.message
}
