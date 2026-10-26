'use server'

/**
 * PRODUCT-DELETE (المرحلة B) — Server Action حذف المنتج نهائيًا (العقد docs/contracts/PRODUCT-DELETE.md §٦).
 *
 * الغلاف actionWithAccess بصلاحية فئة المالك zell.orders.payments_admin (نفس صلاحية إعدادات المالك في 0021-D2 و
 * EXPRESS-SHIPPING، من غير صلاحية جديدة في 0021-P). الترتيب: الهوية والصلاحية ← علم التعديلات ← التحقق ←
 * zell_product_delete بجلسة المستخدم. القرار النهائي في الداتابيز (المالك بس 45402)، فأي أدمن معاه الصلاحية برضه بيترفض.
 * بعد النجاح: تحديث المتجر (/api/revalidate)، ولو فشل التحديث النتيجة بتنجح بتحذير.
 */

import { actionWithAccess } from './access/instance'
import type { AccessContext } from './access/wrappers'
import type { MutationResult } from './mutations'
import { deleteProduct } from './mutations/productDelete'
import type { ProductDeleteResult } from './products/deleteProduct'
import { REVALIDATION_WARNING, revalidateStorefront } from './revalidateStorefront'

export const deleteProductAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: true },
  async (_ctx: AccessContext, productId: number, expectedUpdatedAt: string): Promise<MutationResult<ProductDeleteResult>> => {
    const result = await deleteProduct(productId, expectedUpdatedAt)
    if (!result.ok) return result
    const refreshed = await revalidateStorefront()
    return refreshed ? result : { ...result, warning: REVALIDATION_WARNING }
  },
)
