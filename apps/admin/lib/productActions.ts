'use server'

/**
 * PRODUCT-DELETE (المرحلة B) — Server Action حذف المنتج نهائيًا (العقد docs/contracts/PRODUCT-DELETE.md §٦).
 *
 * الغلاف actionWithAccess بصلاحية فئة المالك zell.orders.payments_admin (نفس صلاحية إعدادات المالك في 0021-D2 و
 * EXPRESS-SHIPPING، من غير صلاحية جديدة في 0021-P)، ورسالة رفض خاصة بالحذف PRODUCT_DELETE_OWNER_ONLY_MESSAGE. الترتيب: الهوية والصلاحية ← علم التعديلات ← التحقق ←
 * zell_product_delete بجلسة المستخدم. القرار النهائي في الداتابيز (المالك بس 45402)، فأي أدمن معاه الصلاحية برضه بيترفض.
 * بعد النجاح: تحديث المتجر (/api/revalidate) مرة واحدة (finishProductDelete)، ولو فشل التحديث النتيجة بتنجح بتحذير
 * PRODUCT_DELETE_STOREFRONT_WARNING، والكارت بيعرضه. الحذف مابيتعادش أبدًا بسبب فشل التحديث.
 */

import { actionWithAccess } from './access/instance'
import type { AccessContext } from './access/wrappers'
import type { MutationResult } from './mutations'
import { deleteProduct } from './mutations/productDelete'
import { PRODUCT_DELETE_OWNER_ONLY_MESSAGE, finishProductDelete, type ProductDeleteResult } from './products/deleteProduct'
import { revalidateStorefront } from './revalidateStorefront'

export const deleteProductAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: true, forbiddenMessage: PRODUCT_DELETE_OWNER_ONLY_MESSAGE },
  async (_ctx: AccessContext, productId: number, expectedUpdatedAt: string): Promise<MutationResult<ProductDeleteResult>> =>
    finishProductDelete(await deleteProduct(productId, expectedUpdatedAt), revalidateStorefront),
)
