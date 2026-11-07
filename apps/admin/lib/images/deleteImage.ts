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

import type { MutationErrorCode, MutationResult } from '../mutations'
import { exactImageId } from './imageId'

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

/** مدخلات الحذف قبل أي نداء: id منتج موجب صحيح، ومعرّف صورة نص أرقام موجب (bigint بيتبعت نص). */
export function imageDeleteInputIssue(productId: unknown, imageId: unknown): string | null {
  if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) return IMAGE_DELETE_MESSAGES.invalid
  if (typeof imageId !== 'string' || exactImageId(imageId) === null) return IMAGE_DELETE_MESSAGES.invalid
  return null
}

/**
 * رد zell_product_image_delete. لازم نفس الصورة، والترقية null أو معرّف صالح، والتسجيل boolean. وإلا null.
 * الدالة بترجّع المعرّفات أرقام jsonb: لو أكبر من المدى الآمن بتوصل مقرّبة فبترجع null («تعذّر تأكيد الحذف»)، مش نجاح لصورة تانية.
 */
export function parseImageDeleteResult(raw: unknown, imageId: string): ImageDeleteResult | null {
  if (!isObj(raw)) return null
  if (exactImageId(raw['deleted_image_id']) !== imageId) return null
  const promotedRaw = raw['promoted_image_id']
  const promoted = promotedRaw === null ? null : exactImageId(promotedRaw)
  if (promotedRaw !== null && promoted === null) return null
  if (promoted === imageId) return null
  const recorded = raw['orphan_recorded']
  if (typeof recorded !== 'boolean') return null
  return { deletedImageId: imageId, promotedImageId: promoted, orphanRecorded: recorded }
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

/** معاملات zell_product_image_delete بالظبط: المنتج رقم، والصورة نص دقيق (bigint مايتبعتش Number). */
export type ImageDeleteArgs = { p_product_id: number; p_image_id: string }

/** نداء الدالة بجلسة المستخدم (lib/mutations/imageDelete.ts). أي فشل في الشبكة أو المهلة = استثناء. */
export type ImageDeleteRpc = (args: ImageDeleteArgs, signal: AbortSignal) => Promise<{ data: unknown; error: unknown; status: number }>

export const IMAGE_DELETE_TIMEOUT_MS = 10000

/**
 * الحذف من أوله لآخره من غير الشبكة نفسها: فحص المدخلات ← نداء واحد بالظبط (من غير إعادة) بمهلة ← تحويل الخطأ أو قراية الرد.
 * المهلة أو ضياع الرد = INTERNAL «تعذّر تأكيد حذف الصورة…» (النتيجة مش معروفة؛ المحاولة التانية بتقول «غير موجودة» لو الحذف حصل).
 */
export async function callImageDelete(
  rpc: ImageDeleteRpc,
  productId: unknown,
  imageId: unknown,
  timeoutMs: number = IMAGE_DELETE_TIMEOUT_MS,
): Promise<MutationResult<ImageDeleteResult>> {
  const issue = imageDeleteInputIssue(productId, imageId)
  if (issue !== null || typeof productId !== 'number' || typeof imageId !== 'string') {
    return { ok: false, code: 'VALIDATION', message: issue ?? IMAGE_DELETE_MESSAGES.invalid }
  }
  try {
    const result = await rpc({ p_product_id: productId, p_image_id: imageId }, AbortSignal.timeout(timeoutMs))
    if (result.error !== null && result.error !== undefined) {
      const failure = imageDeleteFailure(result.error, result.status)
      return { ok: false, code: failure.code, message: failure.message }
    }
    const parsed = parseImageDeleteResult(result.data, imageId)
    if (parsed === null) return { ok: false, code: 'INTERNAL', message: IMAGE_DELETE_MESSAGES.internal }
    return { ok: true, data: parsed }
  } catch {
    return { ok: false, code: 'INTERNAL', message: IMAGE_DELETE_MESSAGES.internal }
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
