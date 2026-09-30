import 'server-only'

import { restRpc } from '../data/client'
import type { MutationResult } from '../mutations'
import { validateFit, validateImageId, validateProductId } from '../validation/image'
import { timestamp } from '../validation/shared'
import { patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'

const TABLE = 'product_images'
const SET_PRIMARY_RPC = 'zell_set_primary_product_image'

/**
 * تغيير طريقة عرض صورة.
 *
 * ملاحظة مقصودة: مفيش قاعدة تربط fit بـ is_primary. cover على الصورة
 * الرئيسية قيمة **افتراضية** مش إلزام، والأدمن يقدر يرجّعها contain.
 */
export async function setImageFit(
  rawImageId: unknown,
  rawFit: unknown,
  rawStamp: unknown,
): Promise<MutationResult<null>> {
  const imageId = validateImageId(rawImageId)
  if (!imageId.ok) return imageId

  const fit = validateFit(rawFit)
  if (!fit.ok) return fit

  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  try {
    const result = await patchGuarded<{ id: string }>({
      table: TABLE,
      idColumn: 'id',
      idValue: imageId.value,
      expectedUpdatedAt: stamp.value,
      changes: { fit: fit.value },
      select: 'id',
    })
    if (!result.ok) return result
    return { ok: true, data: null }
  } catch (error) {
    return toInternalFailure(error)
  }
}

/**
 * تعيين الصورة الرئيسية — **عن طريق دالة الداتابيز الموجودة**.
 *
 * zell_set_primary_product_image بتاخد أقفال FOR UPDATE على صور المنتج،
 * بتنزّل الرئيسية القديمة لـ contain، وبترفع الجديدة لـ cover، كله في
 * معاملة واحدة. وده مش ترف: في unique index جزئي
 * (product_images_one_primary_idx ... where is_primary) بيرفض أي لحظة
 * فيها رئيسيتين — يعني تعديلين متتاليين من الكود كانوا هيفشلوا.
 *
 * ⚠️ ممنوع تقليد الدالة دي في TypeScript.
 *
 * بترجّع updated_at الجديد، أو null لو الصورة مش من صور المنتج ده.
 * مفيش expectedUpdatedAt هنا: الأقفال هي وسيلة التحكم في التزامن.
 *
 * الواجهة لازم تعيد قراءة المنتج كامل بعد النجاح — العملية بتغيّر
 * أكتر من صف، فتحديث حقل واحد محليًا بيعرض حالة غلط.
 */
export async function setPrimaryImage(rawProductId: unknown, rawImageId: unknown): Promise<MutationResult<null>> {
  const productId = validateProductId(rawProductId)
  if (!productId.ok) return productId

  const imageId = validateImageId(rawImageId)
  if (!imageId.ok) return imageId

  try {
    const changedAt = await restRpc<string | null>(SET_PRIMARY_RPC, {
      p_product_id: productId.value,
      // نص عن قصد — bigint مايمرش كـ Number
      p_image_id: imageId.value,
    })

    if (changedAt === null) {
      return { ok: false, code: 'NOT_FOUND', message: 'الصورة دي مش من صور المنتج ده.' }
    }
    return { ok: true, data: null }
  } catch (error) {
    return toInternalFailure(error)
  }
}
