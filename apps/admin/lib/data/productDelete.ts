import 'server-only'

import { createAuthClient } from '../auth/supabaseServer'
import { parseProductDeletePreview, type ProductDeletePreview } from '../products/deleteProduct'

/**
 * PRODUCT-DELETE (المرحلة B) — معاينة حذف المنتج (zell_product_delete_preview، 0022) بجلسة المستخدم: anon key + كوكيز الجلسة،
 * من غير service_role ولا أي معامل ممثل. المالك بس (القرار في الداتابيز). أي فشل = null، والكارت بيعرض «تعذّر التحميل»
 * من غير ما الصفحة تقع. اسم الدالة ثابت هنا.
 */
const TIMEOUT_MS = 10000

export async function readProductDeletePreview(productId: number): Promise<ProductDeletePreview | null> {
  try {
    const supabase = await createAuthClient()
    const result = await supabase
      .rpc('zell_product_delete_preview', { p_product_id: productId })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
    if (result.error !== null) return null
    const preview = parseProductDeletePreview(result.data as unknown)
    return preview !== null && preview.productId === productId ? preview : null
  } catch {
    return null
  }
}
