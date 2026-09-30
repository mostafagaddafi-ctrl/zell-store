import 'server-only'

import type { AdminProduct } from '../adminData'
import { restGet, restInsert } from '../data/client'
import { toAdminProduct, type ProductRow } from '../data/rows'
import type { MutationResult } from '../mutations'
import { validateProduct, type ProductInput } from '../validation/product'
import { flag, timestamp, wholeNumber } from '../validation/shared'
import { patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'

const TABLE = 'products'

/** نفس أعمدة القراءة — الرد بيتحوّل بنفس المحوّل. */
const RETURN_COLUMNS = [
  'id',
  'name_ar',
  'name_en',
  'brand',
  'description_ar',
  'short_benefit',
  'benefits',
  'price_per_meter_piastres',
  'width_cm',
  'min_length_cm',
  'step_cm',
  'max_length_cm',
  'is_active',
  'sort_order',
  'updated_at',
].join(',')

async function imageCount(productId: number): Promise<number> {
  const result = await restGet<{ id: string }>(
    'product_images',
    'select=id&product_id=eq.' + String(productId) + '&limit=1',
    { exactCount: true },
  )
  return result.total ?? 0
}

/**
 * إنشاء أو تعديل منتج.
 *
 * expectedUpdatedAt **إلزامي** لما يكون في id، ومابيتطلبش في الإنشاء
 * لأن مفيش نسخة سابقة يتقارن بيها.
 */
export async function saveProduct(input: ProductInput): Promise<MutationResult<AdminProduct>> {
  const validated = validateProduct(input)
  if (!validated.ok) return validated

  try {
    if (input.id === undefined || input.id === null) {
      const rows = await restInsert<ProductRow>(TABLE, validated.columns, RETURN_COLUMNS)
      const row = rows[0]
      if (!row) return toInternalFailure(null)
      // منتج جديد = مفيش صور بعد
      return { ok: true, data: toAdminProduct(row, 0) }
    }

    const id = wholeNumber(input.id, 'معرّف المنتج')
    if (!id.ok) return id

    const stamp = timestamp(input.expectedUpdatedAt, 'طابع آخر تعديل')
    if (!stamp.ok) return stamp

    const result = await patchGuarded<ProductRow>({
      table: TABLE,
      idColumn: 'id',
      idValue: id.value,
      expectedUpdatedAt: stamp.value,
      changes: validated.columns,
      select: RETURN_COLUMNS,
    })
    if (!result.ok) return result

    const row = result.rows[0]
    if (!row) return toInternalFailure(null)
    return { ok: true, data: toAdminProduct(row, await imageCount(id.value)) }
  } catch (error) {
    return toInternalFailure(error)
  }
}

export async function setProductVisibility(
  rawId: unknown,
  rawVisible: unknown,
  rawStamp: unknown,
): Promise<MutationResult<AdminProduct>> {
  const id = wholeNumber(rawId, 'معرّف المنتج')
  if (!id.ok) return id

  const visible = flag(rawVisible, 'الإظهار')
  if (!visible.ok) return visible

  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  try {
    const result = await patchGuarded<ProductRow>({
      table: TABLE,
      idColumn: 'id',
      idValue: id.value,
      expectedUpdatedAt: stamp.value,
      changes: { is_active: visible.value },
      select: RETURN_COLUMNS,
    })
    if (!result.ok) return result

    const row = result.rows[0]
    if (!row) return toInternalFailure(null)
    return { ok: true, data: toAdminProduct(row, await imageCount(id.value)) }
  } catch (error) {
    return toInternalFailure(error)
  }
}
