'use client'

import type { AdminImage } from '../adminData'
import type { MutationResult } from '../mutations'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from './uploadImage'

/**
 * رفع صورة موقع من المتصفح.
 *
 * الحد المعلن ٤ ميجابايت — نفس سبب صور المنتجات: Vercel بترفض أجسام
 * الطلبات فوق ~٤.٥ ميجا على مستوى المنصة، فالدالة مابتشتغلش أصلاً
 * والعميل بياخد 413 من غير أي MutationResult.
 */

export type SiteImageKind = 'logo' | 'hero'

const NETWORK = 'فشل الاتصال بالسيرفر. جرّب تاني.'
const UNREADABLE = 'السيرفر رجّع رد غير متوقع. اعمل تحديث للصفحة وراجع الصور.'
const TOO_LARGE = 'الصورة أكبر من المسموح. أقصى حجم ' + String(MAX_UPLOAD_MB) + ' ميجابايت.'

function isMutationResult(value: unknown): value is MutationResult<AdminImage> {
  return typeof value === 'object' && value !== null && 'ok' in value
}

export async function uploadSiteImage(args: {
  kind: SiteImageKind
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
  body.set('kind', args.kind)

  let response: Response
  try {
    response = await fetch('/api/admin/site-images', { method: 'POST', body })
  } catch {
    return { ok: false, code: 'INTERNAL', message: NETWORK }
  }

  // 413 ممكن تيجي من المنصة قبل ما الراوت يشتغل — الجسم ساعتها مش بتاعنا
  if (response.status === 413) {
    return { ok: false, code: 'VALIDATION', message: TOO_LARGE }
  }

  try {
    const payload: unknown = await response.json()
    if (isMutationResult(payload)) return payload
  } catch {
    // نكمل للرسالة العامة
  }

  return { ok: false, code: 'INTERNAL', message: UNREADABLE }
}
