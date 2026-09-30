'use client'

import type { AdminImage } from '../adminData'
import type { MutationResult } from '../mutations'

/**
 * الحد المعلن في الواجهة: **٤ ميجابايت**.
 *
 * ⚠️ ليه ٤ مش ٥؟ Vercel بترفض أجسام الطلبات فوق ~٤.٥ ميجا على مستوى
 * المنصة — الدالة بتاعتنا مابتشتغلش أصلاً، والعميل بياخد 413 من غير
 * أي MutationResult. فبنرفض في الواجهة على ٤ برسالة واضحة، وفحص الـ٥
 * في الراوت بيفضل كدفاع تاني متوافق مع حد الـ bucket.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
export const MAX_UPLOAD_MB = 4

const NETWORK = 'فشل الاتصال بالسيرفر. جرّب تاني.'
const UNREADABLE = 'السيرفر رجّع رد غير متوقع. اعمل تحديث للصفحة وراجع صور المنتج.'
const TOO_LARGE = 'الصورة أكبر من المسموح. أقصى حجم ' + String(MAX_UPLOAD_MB) + ' ميجابايت.'

function isMutationResult(value: unknown): value is MutationResult<AdminImage> {
  return typeof value === 'object' && value !== null && 'ok' in value
}

export async function uploadProductImage(args: {
  productId: number
  file: File
  altText: string
}): Promise<MutationResult<AdminImage>> {
  if (args.file.size === 0) {
    return { ok: false, code: 'VALIDATION', message: 'الملف فاضي.' }
  }
  if (args.file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'VALIDATION', message: TOO_LARGE }
  }

  const body = new FormData()
  body.set('file', args.file)
  body.set('altText', args.altText)
  // الواجهة بترفع gallery بس. before و after مدعومين في الراوت من غير واجهة.
  body.set('kind', 'gallery')

  let response: Response
  try {
    response = await fetch('/api/admin/products/' + String(args.productId) + '/images', {
      method: 'POST',
      body,
    })
  } catch {
    return { ok: false, code: 'INTERNAL', message: NETWORK }
  }

  /**
   * 413 ممكن تيجي من المنصة نفسها قبل ما الراوت يشتغل، وساعتها
   * الجسم مش بتاعنا. بنترجمها لرسالة مفهومة بدل «رد غير متوقع».
   */
  if (response.status === 413) {
    return { ok: false, code: 'VALIDATION', message: TOO_LARGE }
  }

  // الجسم بيتقرا في كل الحالات — كود الحالة لوحده مش كفاية
  try {
    const payload: unknown = await response.json()
    if (isMutationResult(payload)) return payload
  } catch {
    // نكمل للرسالة العامة
  }

  return { ok: false, code: 'INTERNAL', message: UNREADABLE }
}
