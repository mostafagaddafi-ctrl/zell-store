import 'server-only'

import { createAuthClient } from '../auth/supabaseServer'
import {
  IMAGE_DELETE_MESSAGES,
  imageDeleteFailure,
  imageDeleteInputIssue,
  parseImageDeleteResult,
  type ImageDeleteResult,
} from '../images/deleteImage'
import type { MutationResult } from '../mutations'

/**
 * IMAGE-DELETE (C1) — حذف صورة من منتج (zell_product_image_delete، 0026) بجلسة المستخدم: مفيش service_role.
 * المالك بس (الغلاف في lib/actions.ts، والقرار النهائي في الداتابيز 45402). معرّف الصورة بيتبعت نص (bigint).
 * لو المهلة خلصت والنتيجة مش معروفة: INTERNAL «تعذّر تأكيد حذف الصورة…»، والمحاولة التانية بتقول «غير موجودة» لو الحذف كان حصل (45701).
 */
const TIMEOUT_MS = 10000

export async function deleteProductImage(productId: number, imageId: string): Promise<MutationResult<ImageDeleteResult>> {
  const issue = imageDeleteInputIssue(productId, imageId)
  if (issue !== null) return { ok: false, code: 'VALIDATION', message: issue }
  try {
    const supabase = await createAuthClient()
    const result = await supabase
      .rpc('zell_product_image_delete', { p_product_id: productId, p_image_id: imageId })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    if (result.error !== null) {
      const failure = imageDeleteFailure(result.error, result.status)
      return { ok: false, code: failure.code, message: failure.message }
    }
    const parsed = parseImageDeleteResult(result.data as unknown, imageId)
    if (parsed === null) return { ok: false, code: 'INTERNAL', message: IMAGE_DELETE_MESSAGES.internal }
    return { ok: true, data: parsed }
  } catch {
    return { ok: false, code: 'INTERNAL', message: IMAGE_DELETE_MESSAGES.internal }
  }
}
