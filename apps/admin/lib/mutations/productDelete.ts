import 'server-only'

import { createAuthClient } from '../auth/supabaseServer'
import type { MutationResult } from '../mutations'
import {
  PRODUCT_DELETE_MESSAGES,
  parseProductDeleteResult,
  productDeleteFailure,
  productDeleteInputIssue,
  type ProductDeleteResult,
} from '../products/deleteProduct'

/**
 * PRODUCT-DELETE (المرحلة B) — حذف المنتج نهائيًا (zell_product_delete، 0022) بجلسة المستخدم: مفيش service_role ولا معامل ممثل.
 * المالك بس (الغلاف في lib/productActions.ts، والقرار النهائي في الداتابيز 45402). النسخة = updated_at من المعاينة.
 * لو المهلة خلصت والنتيجة مش معروفة: INTERNAL، والمحاولة التانية بتقول «غير موجود» لو الحذف كان حصل (45501).
 */
const TIMEOUT_MS = 10000

export async function deleteProduct(productId: number, expectedUpdatedAt: string): Promise<MutationResult<ProductDeleteResult>> {
  const issue = productDeleteInputIssue(productId, expectedUpdatedAt)
  if (issue !== null) return { ok: false, code: 'VALIDATION', message: issue }
  try {
    const supabase = await createAuthClient()
    const result = await supabase
      .rpc('zell_product_delete', { p_product_id: productId, p_expected_updated_at: expectedUpdatedAt })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    if (result.error !== null) {
      const failure = productDeleteFailure(result.error, result.status)
      return { ok: false, code: failure.code, message: failure.message }
    }
    const parsed = parseProductDeleteResult(result.data as unknown, productId)
    if (parsed === null) return { ok: false, code: 'INTERNAL', message: PRODUCT_DELETE_MESSAGES.internal }
    return { ok: true, data: parsed }
  } catch {
    return { ok: false, code: 'INTERNAL', message: PRODUCT_DELETE_MESSAGES.internal }
  }
}
