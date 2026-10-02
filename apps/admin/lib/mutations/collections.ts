import 'server-only'

import type { AdminCollection } from '../adminData'
import { projectUrl, restGet, restRpc, sentinelOf } from '../data/client'
import { COLLECTION_SELECT, toAdminCollection, type CollectionRow } from '../data/rows'
import type { MutationResult } from '../mutations'
import {
  validateCollection,
  validateCollectionId,
  validateCollectionOrder,
  validateCollectionPlacement,
  validateExpectedUpdatedAt,
  validateProductIds,
  type CollectionInput,
} from '../validation/collection'
import { CONFLICT_MESSAGE, patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'

/**
 * تعديلات الأقسام.
 *
 * ⚠️ الكتابة اللي بتمس **أكتر من صف** بتمر على دالة داتابيز:
 *      الإنشاء       -> zell_create_collection   (بيزحزح الكل خانة)
 *      الحذف         -> zell_delete_collection   (+ تسجيل الغلاف للتنظيف)
 *      ربط المنتجات  -> zell_set_collection_products
 *      الترتيب       -> zell_reorder_collections
 *    الكتابة على صف واحد (تعديل البيانات، مفاتيح الظهور) بتمر على REST
 *    بتزامن تفاؤلي — القفل بيحصل بفلتر updated_at في نفس الطلب.
 *
 * ⚠️ القسم الجديد بيبدأ **أول** الترتيب (0012). مفيش أولوية محجوزة
 *    لأي قسم — الترتيب كله في إيد الأدمن بعد كده.
 *
 * ⚠️ is_visible بيتكتب = show_on_home or show_in_nav عشان نسخة المتجر
 *    القديمة تفضل متسقة لحد ما الكود الجديد ينزل. مابيتقراش من هنا.
 *
 * ⚠️ تفرّد الـslug مضمون بقيد الداتابيز مش بالفحص المبدئي. الفحص
 *    المبدئي للرسالة بس.
 */

const TABLE = 'collections'
const CREATE_RPC = 'zell_create_collection'
const DELETE_RPC = 'zell_delete_collection'
const SET_PRODUCTS_RPC = 'zell_set_collection_products'
const REORDER_RPC = 'zell_reorder_collections'

const SLUG_TAKEN = 'الرابط المختصر ده مستخدم في قسم تاني. اختار رابط غيره.'
const ORDER_MISMATCH = 'الترتيب لازم يشمل كل الأقسام مرة واحدة بالظبط. اعمل تحديث للصفحة وحاول تاني.'
const PRODUCTS_INVALID = 'في منتج مش موجود أو مكرر في القائمة. اعمل تحديث للصفحة وحاول تاني.'
const COLLECTION_GONE = 'القسم مش موجود. يمكن يكون اتمسح.'

/** العدّ الكلي والنشط لمنتجات قسم. */
export async function collectionProductCounts(collectionId: string): Promise<{ total: number; active: number }> {
  const links = await restGet<{ product_id: number }>(
    'product_collections',
    'select=product_id&collection_id=eq.' + encodeURIComponent(collectionId),
  )
  const ids = links.rows.map((row) => row.product_id)
  if (ids.length === 0) return { total: 0, active: 0 }

  const active = await restGet<{ id: number }>(
    'products',
    'select=id&is_active=eq.true&id=in.(' + ids.map((id) => String(id)).join(',') + ')',
  )
  return { total: ids.length, active: active.rows.length }
}

/** القراءة بعد الكتابة — النجاح لازم يعكس الحالة المخزّنة فعلًا. */
export async function readAdminCollection(id: string): Promise<AdminCollection | null> {
  const rows = await restGet<CollectionRow>(
    TABLE,
    'select=' + COLLECTION_SELECT + '&id=eq.' + encodeURIComponent(id) + '&limit=1',
  )
  const row = rows.rows[0]
  if (!row) return null
  return toAdminCollection(row, await collectionProductCounts(id), projectUrl())
}

/** هل الـslug محجوز لقسم تاني؟ للرسالة بس — القيد هو الحارس. */
async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  let query = 'select=id&slug=eq.' + encodeURIComponent(slug) + '&limit=2'
  if (exceptId !== undefined) query += '&id=neq.' + encodeURIComponent(exceptId)
  const found = await restGet<{ id: string }>(TABLE, query)
  return found.rows.length > 0
}

/** خطأ قيد التفرّد بيتحوّل رسالة مفهومة بدل «خطأ غير متوقع». */
function slugConflict(error: unknown): boolean {
  if (sentinelOf(error) === 'ZELL_COLLECTION_SLUG_TAKEN') return true
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

    const returned = await restRpc<string | number | null>(CREATE_RPC, {
      p_slug: checked.payload.slug,
      p_title: checked.payload.title,
      p_subtitle: checked.payload.subtitle,
      p_show_on_home: checked.payload.showOnHome,
      p_show_in_nav: checked.payload.showInNav,
    })
    if (returned === null || returned === undefined) return toInternalFailure(null)

    const created = await readAdminCollection(String(returned))
    if (!created) return toInternalFailure(null)
    return { ok: true, data: created }
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
        show_on_home: checked.payload.showOnHome,
        show_in_nav: checked.payload.showInNav,
        is_visible: checked.payload.showOnHome || checked.payload.showInNav,
      },
      select: COLLECTION_SELECT,
    })
    if (!result.ok) return result

    const row = result.rows[0]
    if (!row) return toInternalFailure(null)
    return { ok: true, data: toAdminCollection(row, await collectionProductCounts(id.value), projectUrl()) }
  } catch (error) {
    if (slugConflict(error)) return { ok: false, code: 'VALIDATION', message: SLUG_TAKEN }
    return toInternalFailure(error)
  }
}

/** مفتاحين الظهور من قائمة الأقسام — من غير ما نلمس باقي البيانات. */
export async function setCollectionPlacement(
  rawId: unknown,
  rawShowOnHome: unknown,
  rawShowInNav: unknown,
  rawExpected: unknown,
): Promise<MutationResult<AdminCollection>> {
  const id = validateCollectionId(rawId)
  if (!id.ok) return id
  const placement = validateCollectionPlacement(rawShowOnHome, rawShowInNav)
  if (!placement.ok) return placement
  const expected = validateExpectedUpdatedAt(rawExpected)
  if (!expected.ok) return expected

  try {
    const result = await patchGuarded<CollectionRow>({
      table: TABLE,
      idColumn: 'id',
      idValue: id.value,
      expectedUpdatedAt: expected.value,
      changes: {
        show_on_home: placement.value.showOnHome,
        show_in_nav: placement.value.showInNav,
        is_visible: placement.value.showOnHome || placement.value.showInNav,
      },
      select: COLLECTION_SELECT,
    })
    if (!result.ok) return result

    const row = result.rows[0]
    if (!row) return toInternalFailure(null)
    return { ok: true, data: toAdminCollection(row, await collectionProductCounts(id.value), projectUrl()) }
  } catch (error) {
    return toInternalFailure(error)
  }
}

/**
 * حذف قسم.
 *
 * ⚠️ الحذف والتزامن وتسجيل ملف الغلاف للتنظيف كلهم جوه
 *    zell_delete_collection في معاملة واحدة (0012). الروابط بتتشال
 *    بالـcascade، والمنتجات نفسها مابتتأثرش.
 */
export async function deleteCollection(rawId: unknown, rawExpected: unknown): Promise<MutationResult<null>> {
  const id = validateCollectionId(rawId)
  if (!id.ok) return id
  const expected = validateExpectedUpdatedAt(rawExpected)
  if (!expected.ok) return expected

  try {
    const outcome = await restRpc<string | null>(DELETE_RPC, {
      p_collection_id: id.value,
      p_expected_updated_at: expected.value,
    })
    if (outcome === 'DELETED') return { ok: true, data: null }
    if (outcome === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND', message: COLLECTION_GONE }
    if (outcome === 'CONFLICT') return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
    return toInternalFailure(null)
  } catch (error) {
    return toInternalFailure(error)
  }
}

/**
 * استبدال قائمة منتجات القسم.
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

  /**
   * ⚠️ **ممنوع نجاح وهمي.** بعد النداء بنقرا الربط المخزّن فعلًا
   *    ونقارنه بالمطلوب — النجاح مابيترجعش غير لما يطابق بالظبط.
   */
  let rpcStatus: string | null = null

  try {
    const count = await restRpc<number | null>(SET_PRODUCTS_RPC, {
      p_collection_id: id.value,
      p_product_ids: ids.value,
    })
    // null = القسم مش موجود (الدالة بترجّع null مش بترمي)
    if (count === null) return { ok: false, code: 'NOT_FOUND', message: COLLECTION_GONE }
  } catch (error) {
    const sentinel = sentinelOf(error)
    if (sentinel === 'ZELL_INVALID_COLLECTION_PRODUCTS') {
      return { ok: false, code: 'VALIDATION', message: PRODUCTS_INVALID }
    }
    if (sentinel === 'ZELL_INVALID_COLLECTION') {
      return { ok: false, code: 'NOT_FOUND', message: COLLECTION_GONE }
    }
    // كود الحالة بس — مفيش أي حرف من جسم رد Supabase
    const match = /\b(\d{3})\b/.exec(error instanceof Error ? error.message : '')
    rpcStatus = match === null ? null : match[1] ?? null
  }

  // التحقق بالقراءة — المرجع الوحيد للنجاح
  let storedIds: number[]
  try {
    const stored = await restGet<{ product_id: number }>(
      'product_collections',
      'select=product_id&collection_id=eq.' + encodeURIComponent(id.value),
    )
    storedIds = stored.rows.map((row) => row.product_id)
  } catch (error) {
    return toInternalFailure(error)
  }

  const wanted = ids.value
  const matches =
    storedIds.length === wanted.length && wanted.every((productId) => storedIds.includes(productId))

  if (!matches) {
    const suffix = rpcStatus === null ? '' : ' (الداتابيز رجّعت الحالة ' + rpcStatus + ')'
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'الربط ما اتحفظش' + suffix + '. اعمل تحديث للصفحة وحاول تاني.',
    }
  }

  return { ok: true, data: null }
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
