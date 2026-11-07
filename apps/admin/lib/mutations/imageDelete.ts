import 'server-only'

import { createAuthClient } from '../auth/supabaseServer'
import { IMAGE_DELETE_TIMEOUT_MS, callImageDelete, type ImageDeleteResult, type ImageDeleteRpc } from '../images/deleteImage'
import type { MutationResult } from '../mutations'

/**
 * IMAGE-DELETE (C1) — حذف صورة من منتج (zell_product_image_delete، 0026) بجلسة المستخدم: مفيش service_role.
 * المالك بس (الغلاف في lib/actions.ts، والقرار النهائي في الداتابيز 45402). معرّف الصورة بيتبعت نص دقيق (bigint).
 * الملف ده التوصيل بس: المنطق كله (المدخلات · نداء واحد بمهلة · الأخطاء · الرد) في callImageDelete (lib/images/deleteImage.ts)
 * ومتختبر في images.cases.ts. المعاملات مكتوبة نصًا هنا علشان فحص عقد الاستدعاء (call_contract.mjs) يشوفها.
 */
const rpc: ImageDeleteRpc = async (args, signal) => {
  const supabase = await createAuthClient()
  const result = await supabase
    .rpc('zell_product_image_delete', { p_product_id: args.p_product_id, p_image_id: args.p_image_id })
    .abortSignal(signal)
  return { data: result.data as unknown, error: result.error as unknown, status: result.status }
}

export async function deleteProductImage(productId: number, imageId: string): Promise<MutationResult<ImageDeleteResult>> {
  return callImageDelete(rpc, productId, imageId, IMAGE_DELETE_TIMEOUT_MS)
}
