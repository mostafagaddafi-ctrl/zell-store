import 'server-only'

import { restGet, restRpc, sentinelOf } from '../data/client'
import type { MutationResult } from '../mutations'
import { validateImageOrder, validateProductOrder } from '../validation/reorder'
import { validateProductId } from '../validation/image'
import { toInternalFailure } from './errors'

const PRODUCTS_RPC = 'zell_reorder_products'
const IMAGES_RPC = 'zell_reorder_product_images'

const PRODUCT_MISMATCH =
  'الترتيب لازم يشمل كل المنتجات مرة واحدة بالظبط. اعمل تحديث للصفحة وحاول تاني.'
const IMAGE_MISMATCH =
  'الترتيب لازم يشمل كل صور المعرض للمنتج ده مرة واحدة بالظبط. اعمل تحديث للصفحة وحاول تاني.'

/**
 * ترتيب المنتجات.
 *
 * الدالة بتكتب sort_order من **١** (with ordinality)، وبترمي
 * ZELL_INVALID_ORDER لو المجموعة المبعوتة مش مساوية لكل المنتجات.
 *
 * ⚠️ "كل المنتجات" يعني المخفية كمان — الدالة بتعدّ public.products
 * كلها من غير أي فلتر على is_active.
 *
 * الفحص المبدئي هنا مرآة لفحص الدالة، الغرض منه رسالة أوضح قبل
 * النداء. الفحص **الملزم** جوه الدالة، وهو اللي بيقفل السباق.
 */
export async function reorderProducts(rawIds: unknown): Promise<MutationResult<null>> {
  const ids = validateProductOrder(rawIds)
  if (!ids.ok) return ids

  try {
    const current = await restGet<{ id: number }>('products', 'select=id')
    const existing = new Set(current.rows.map((row) => row.id))
    const complete = existing.size === ids.value.length && ids.value.every((id) => existing.has(id))
    if (!complete) return { ok: false, code: 'VALIDATION', message: PRODUCT_MISMATCH }

    const updated = await restRpc<number>(PRODUCTS_RPC, { p_ids: ids.value })
    if (updated !== ids.value.length) return toInternalFailure(null)
    return { ok: true, data: null }
  } catch (error) {
    if (sentinelOf(error) === 'ZELL_INVALID_ORDER') {
      return { ok: false, code: 'VALIDATION', message: PRODUCT_MISMATCH }
    }
    return toInternalFailure(error)
  }
}

/**
 * ترتيب صور معرض منتج.
 *
 * الدالة بتكتب sort_order من **صفر** (ord - 1)، وبتشتغل على صور
 * kind = 'gallery' بس. before و after مش داخلين.
 *
 * المعرّفات **نصوص** لحد ما توصل الداتابيز — bigint فوق 2^53 بيفقد
 * دقته لو عدّى على Number.
 */
export async function reorderProductImages(rawProductId: unknown, rawIds: unknown): Promise<MutationResult<null>> {
  const productId = validateProductId(rawProductId)
  if (!productId.ok) return productId

  const ids = validateImageOrder(rawIds)
  if (!ids.ok) return ids

  try {
    const current = await restGet<{ id: string }>(
      'product_images',
      'select=id&product_id=eq.' + String(productId.value) + '&kind=eq.gallery',
    )
    const existing = new Set(current.rows.map((row) => String(row.id)))
    const complete = existing.size === ids.value.length && ids.value.every((id) => existing.has(id))
    if (!complete) return { ok: false, code: 'VALIDATION', message: IMAGE_MISMATCH }

    const updated = await restRpc<number>(IMAGES_RPC, {
      p_product_id: productId.value,
      // نصوص عن قصد
      p_image_ids: ids.value,
    })
    if (updated !== ids.value.length) return toInternalFailure(null)
    return { ok: true, data: null }
  } catch (error) {
    if (sentinelOf(error) === 'ZELL_INVALID_ORDER') {
      return { ok: false, code: 'VALIDATION', message: IMAGE_MISMATCH }
    }
    return toInternalFailure(error)
  }
}
