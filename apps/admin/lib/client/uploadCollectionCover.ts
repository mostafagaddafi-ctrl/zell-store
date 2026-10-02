'use client'

import type { AdminCollection } from '../adminData'
import type { MutationResult } from '../mutations'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from './uploadImage'

/**
 * رفع غلاف قسم من المتصفح — نفس حدود uploadSiteImage (حد المنصة ~٤.٥ ميجا).
 * الضغط لـ WebP بيحصل قبل النداء ده في الواجهة (compressUploadImage).
 */

const NETWORK = 'فشل الاتصال بالسيرفر. جرّب تاني.'
const UNREADABLE = 'السيرفر رجّع رد غير متوقع. اعمل تحديث للصفحة وراجع صورة القسم.'
const TOO_LARGE = 'الصورة أكبر من المسموح. أقصى حجم ' + String(MAX_UPLOAD_MB) + ' ميجابايت.'

function isMutationResult(value: unknown): value is MutationResult<AdminCollection> {
  return typeof value === 'object' && value !== null && 'ok' in value
}

export async function uploadCollectionCover(args: {
  collectionId: string
  file: File
}): Promise<MutationResult<AdminCollection>> {
  if (args.file.size === 0) {
    return { ok: false, code: 'VALIDATION', message: 'الملف فاضي.' }
  }
  if (args.file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'VALIDATION', message: TOO_LARGE }
  }

  const body = new FormData()
  body.set('file', args.file)

  let response: Response
  try {
    response = await fetch('/api/admin/collections/' + encodeURIComponent(args.collectionId) + '/cover', {
      method: 'POST',
      body,
    })
  } catch {
    return { ok: false, code: 'INTERNAL', message: NETWORK }
  }

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
