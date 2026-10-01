import 'server-only'

import type { AdminCollection } from '../adminData'
import { restDelete, restGet, restInsert, restRpc, sentinelOf } from '../data/client'
import { toAdminCollection, type CollectionRow } from '../data/rows'
import type { MutationResult } from '../mutations'
import {
  validateCollection,
  validateCollectionId,
  validateCollectionOrder,
  validateExpectedUpdatedAt,
  validateProductIds,
  type CollectionInput,
} from '../validation/collection'
import { flag } from '../validation/shared'
import { patchGuarded, sameInstant, CONFLICT_MESSAGE } from './concurrency'
import { toInternalFailure } from './errors'

/**
 * تعديلات المجموعات.
 *
 * ⚠️ الكتابة اللي بتمس **أكتر من صف** بتمر على دالة داتابيز:
 *      ربط المنتجات -> zell_set_collection_products
 *      الترتيب       -> zell_reorder_collections
 *    الكتابة على صف واحد (إنشاء، تعديل بيانات، إظهار، حذف) بتمر على
 *    REST بتزامن تفاؤلي — القفل بيحصل بفلتر updated_at في نفس الطلب.
 *
 * ⚠️ تفرّد الـslug مضمون بقيد الداتابيز مش بالفحص المبدئي. الفحص
 *    المبدئي للرسالة بس؛ بينه وبين الإدخال في نافذة سباق، والقيد هو
 *    اللي بيقفلها فعلًا.
 */

const TABLE = 'collections'
const SET_PRODUCTS_RPC = 'zell_set_collection_products'
const REORDER_RPC = 'zell_reorder_collections'

const RETURN_COLUMNS = ['id', 'slug', 'title_ar', 'subtitle_ar', 'is_visible', 'sort_order', 'updated_at'].join(',')

const SLUG_TAKEN = 'الرابط المختصر ده مستخدم في مجموعة تانية. اختار رابط غيره.'
const ORDER_MISMATCH = 'الترتيب لازم يشمل كل المجموعات مرة واحدة بالظبط. اعمل تحديث للصفحة وحاول تاني.'
const PRODUCTS_INVALID = 'في منتج مش موجود أو مكرر في القائمة. اعمل تحديث للصفحة وحاول تاني.'
const COLLECTION_GONE = 'المجموعة مش موجودة. يمكن تكون اتمسحت.'

/** هل الـslug محجوز لمجموعة تانية؟ للرسالة بس — القيد هو الحارس. */
async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  let query = 'select=id&slug=eq.' + encodeURIComponent(slug) + '&limit=2'
  if (exceptId !== undefined) query += '&id=neq.' + encodeURIComponent(exceptId)
  const found = await restGet<{ id: string }>(TABLE, query)
  return found.rows.length > 0
}

/** خطأ قيد التفرّد بيتحوّل رسالة مفهومة بدل «خطأ غير متوقع». */
function slugConflict(error: unknown): boolean {
  const text = error instanceof Error ? error.message : ''
  return text.includes('collections_slug_unique') || text.includes('duplicate key')
}

export async function createCollection(input: CollectionInput): Promise<MutationResult<AdminCollection>> {
  const checked = validateCollection(input)
  if (!checked.ok) return checked

  try {
    if (await slugTaken(checked.payload.slug)) {
      return { ok: false, code: 'VALIDATION', message: SLUG_TAKEN }
    }

    // المجموعة الجديدة في الآخر. sort_order بيتظبط بعدها من الترتيب.
    const highest = await restGet<{ sort_order: number }>(TABLE, 'select=sort_order&order=sort_order.desc&limit=1')
    const top = highest.rows[0]
    const sortOrder = top === undefined ? 0 : top.sort_order + 1

    const rows = await restInsert<CollectionRow>(
      TABLE,
      {
        slug: checked.payload.slug,
        title_ar: checked.payload.title,
        subtitle_ar: checked.payload.subtitle,
        is_visible: checked.payload.isVisible,
        sort_order: sortOrder,
      },
      RETURN_COLUMNS,
    )
    const row = rows[0]
    if (!row) return toInternalFailure(null)
    return { ok: true, data: toAdminCollection(row, 0) }
  } catch (error) {
    if (slugConflict(error)) return { ok: false, code: 'VALIDATION', message: SLUG_TAKEN }
    return toInternalFailure(error)
  }
}

export async function updateCollection(
  rawId: unknown,
  input: CollectionInput,
  rawExpected: unknown,
): Promise<MutationResult<AdminCollection>> {
  const id = validateCollectionId(rawId)
  if (!id.ok) return id
  const expected = validateExpectedUpdatedAt(rawExpected)
  if (!expected.ok) return expected
  const checked = validateCollection(input)
  if (!checked.ok) return checked

  try {
    if (await slugTaken(checked.payload.slug, id.value)) {
      return { ok: false, code: 'VALIDATION', message: SLUG_TAKEN }
    }

    const result = await patchGuarded<CollectionRow>({
      table: TABLE,
      idColumn: 'id',
      idValue: id.value,
      expectedUpdatedAt: expected.value,
      changes: {
        slug: checked.payload.slug,
        title_ar: checked.payload.title,
        subtitle_ar: checked.payload.subtitle,
        is_visible: checked.payload.isVisible,
      },
      select: RETURN_COLUMNS,
    })
    if (!result.ok) return result

    const row = result.rows[0]
    if (!row) return toInternalFailure(null)

    const links = await restGet<{ product_id: number }>(
      'product_collections',
      'select=product_id&collection_id=eq.' + encodeURIComponent(id.value),
    )
    return { ok: true, data: toAdminCollection(row, links.rows.length) }
  } catch (error) {
    if (slugConflict(error)) return { ok: false, code: 'VALIDATION', message: SLUG_TAKEN }
    return toInternalFailure(error)
  }
}

export async function setCollectionVisibility(
  rawId: unknown,
  rawVisible: unknown,
  rawExpected: unknown,
): Promise<MutationResult<AdminCollection>> {
  const id = validateCollectionId(rawId)
  if (!id.ok) return id
  const visible = flag(rawVisible, 'إظهار المجموعة')
  if (!visible.ok) return visible
  const expected = validateExpectedUpdatedAt(rawExpected)
  if (!expected.ok) return expected

  try {
    const result = await patchGuarded<CollectionRow>({
      table: TABLE,
      idColumn: 'id',
      idValue: id.value,
      expectedUpdatedAt: expected.value,
      changes: { is_visible: visible.value },
      select: RETURN_COLUMNS,
    })
    if (!result.ok) return result

    const row = result.rows[0]
    if (!row) return toInternalFailure(null)

    const links = await restGet<{ product_id: number }>(
      'product_collections',
      'select=product_id&collection_id=eq.' + encodeURIComponent(id.value),
    )
    return { ok: true, data: toAdminCollection(row, links.rows.length) }
  } catch (error) {
    return toInternalFailure(error)
  }
}

/**
 * حذف مجموعة.
 *
 * ⚠️ الحذف محمي بنفس التزامن التفاؤلي: بنقرا updated_at، نقارنه،
 *    وبعدين نحذف **بفلتر updated_at** — فلو حد عدّل بين القراءة
 *    والحذف، الحذف بيأثر على صفر صفوف وبنرجّع CONFLICT بدل ما نمسح
 *    نسخة ما شافهاش الأدمن.
 *
 * ⚠️ الروابط بتتشال بالـcascade من 0010. مفيش ملفات متأثرة — مجموعات
 *    v1 مالهاش صور.
 */
export async function deleteCollection(rawId: unknown, rawExpected: unknown): Promise<MutationResult<null>> {
  const id = validateCollectionId(rawId)
  if (!id.ok) return id
  const expected = validateExpectedUpdatedAt(rawExpected)
  if (!expected.ok) return expected

  try {
    const current = await restGet<{ updated_at: string }>(
      TABLE,
      'select=updated_at&id=eq.' + encodeURIComponent(id.value) + '&limit=1',
    )
    const row = current.rows[0]
    if (!row) return { ok: false, code: 'NOT_FOUND', message: COLLECTION_GONE }
    if (!sameInstant(expected.value, row.updated_at)) {
      return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
    }

    const removed = await restDelete<{ id: string }>(
      TABLE,
      'id=eq.' + encodeURIComponent(id.value) + '&updated_at=eq.' + encodeURIComponent(row.updated_at),
    )
    if (removed.length === 0) return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
    return { ok: true, data: null }
  } catch (error) {
    return toInternalFailure(error)
  }
}

/**
 * استبدال قائمة منتجات المجموعة.
 *
 * القائمة الفاضية مسموحة ومعناها «شيل كل الربط».
 * الذرّية والقفل جوه الدالة — شوف 0010.
 */
export async function setCollectionProducts(
  rawId: unknown,
  rawProductIds: unknown,
): Promise<MutationResult<null>> {
  const id = validateCollectionId(rawId)
  if (!id.ok) return id
  const ids = validateProductIds(rawProductIds)
  if (!ids.ok) return ids

  try {
    const count = await restRpc<number | null>(SET_PRODUCTS_RPC, {
      p_collection_id: id.value,
      p_product_ids: ids.value,
    })
    // null = المجموعة مش موجودة (الدالة بترجّع null مش بترمي)
    if (count === null) return { ok: false, code: 'NOT_FOUND', message: COLLECTION_GONE }
    if (count !== ids.value.length) return toInternalFailure(null)
    return { ok: true, data: null }
  } catch (error) {
    const sentinel = sentinelOf(error)
    if (sentinel === 'ZELL_INVALID_COLLECTION_PRODUCTS') {
      return { ok: false, code: 'VALIDATION', message: PRODUCTS_INVALID }
    }
    if (sentinel === 'ZELL_INVALID_COLLECTION') {
      return { ok: false, code: 'NOT_FOUND', message: COLLECTION_GONE }
    }
    return toInternalFailure(error)
  }
}

export async function reorderCollections(rawIds: unknown): Promise<MutationResult<null>> {
  const ids = validateCollectionOrder(rawIds)
  if (!ids.ok) return ids

  try {
    const current = await restGet<{ id: string }>(TABLE, 'select=id')
    const existing = new Set(current.rows.map((row) => String(row.id)))
    const complete = existing.size === ids.value.length && ids.value.every((id) => existing.has(id))
    if (!complete) return { ok: false, code: 'VALIDATION', message: ORDER_MISMATCH }

    const updated = await restRpc<number>(REORDER_RPC, { p_ids: ids.value })
    if (updated !== ids.value.length) return toInternalFailure(null)
    return { ok: true, data: null }
  } catch (error) {
    if (sentinelOf(error) === 'ZELL_INVALID_ORDER') {
      return { ok: false, code: 'VALIDATION', message: ORDER_MISMATCH }
    }
    return toInternalFailure(error)
  }
}
