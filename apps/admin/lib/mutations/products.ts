import 'server-only'

import type { AdminProduct } from '../adminData'
import { restGet, restInsert } from '../data/client'
import { toAdminProduct, type ProductRow } from '../data/rows'
import type { MutationResult } from '../mutations'
import { validateProduct, type ProductInput } from '../validation/product'
import { flag, timestamp, wholeNumber, type ValidationFailure } from '../validation/shared'
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
  'lock_width',
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

// ── شروط جاهزية التفعيل ──────────────────────────────────────
/**
 * المنتج النشط لازم يكون مكتمل.
 *
 * ⚠️ القاعدة دي **مطبّقة في التطبيق بس** — مفيش قيد في الداتابيز
 * بيمنع is_active = true على منتج ناقص. يعني أي مسار كتابة جديد
 * لازم يمر من هنا، وإلا القاعدة بتتسرّب.
 *
 * "صورة رئيسية واحدة بالظبط": الـ unique index الجزئي
 * product_images_one_primary_idx بيضمن **مايزيدش** عن واحدة،
 * فالفحص هنا أساسًا بيقيس الصفر. limit=2 عشان نكشف المستحيل لو حصل.
 */
const ACTIVATION_PREFIX = 'ماينفعش تفعّل المنتج قبل ما تكمّل: '

function activationFailure(missing: string[]): ValidationFailure {
  return { ok: false, code: 'VALIDATION', message: ACTIVATION_PREFIX + missing.join(' · ') + '.' }
}

function missingTexts(descriptionAr: string | null, shortBenefit: string | null): string[] {
  const missing: string[] = []
  if ((descriptionAr ?? '').trim() === '') missing.push('الوصف')
  if ((shortBenefit ?? '').trim() === '') missing.push('الفايدة المختصرة')
  return missing
}

async function hasPrimaryGalleryImage(productId: number): Promise<boolean> {
  const result = await restGet<{ id: string }>(
    'product_images',
    'select=id&product_id=eq.' + String(productId) + '&kind=eq.gallery&is_primary=is.true&limit=2',
  )
  return result.rows.length === 1
}

type ReadinessRow = { description_ar: string | null; short_benefit: string | null }

/**
 * جاهزية التفعيل من **الحالة المخزّنة** — للتفعيل المستقل.
 */
async function storedReadiness(
  productId: number,
): Promise<{ ok: true } | ValidationFailure | { ok: false; code: 'NOT_FOUND'; message: string }> {
  const found = await restGet<ReadinessRow>(
    TABLE,
    'select=description_ar,short_benefit&id=eq.' + String(productId) + '&limit=1',
  )
  const row = found.rows[0]
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'المنتج مش موجود. يمكن يكون اتمسح.' }

  const missing = missingTexts(row.description_ar, row.short_benefit)
  if (!(await hasPrimaryGalleryImage(productId))) missing.push('صورة رئيسية من المعرض')
  if (missing.length > 0) return activationFailure(missing)
  return { ok: true }
}

/**
 * جاهزية التفعيل وقت الحفظ — بتستخدم النصوص **الجاية في نفس الحفظة**
 * مش المخزّنة، لأن نفس الحفظة ممكن تكون هي اللي بتكمّل الناقص.
 * الصورة الرئيسية بتتقرا من المخزّن لأنها مش جزء من حفظ المنتج.
 */
async function incomingReadiness(
  productId: number,
  descriptionAr: string | null,
  shortBenefit: string | null,
): Promise<{ ok: true } | ValidationFailure> {
  const missing = missingTexts(descriptionAr, shortBenefit)
  if (!(await hasPrimaryGalleryImage(productId))) missing.push('صورة رئيسية من المعرض')
  if (missing.length > 0) return activationFailure(missing)
  return { ok: true }
}

// ── العمليات ─────────────────────────────────────────────────
/**
 * إنشاء أو تعديل منتج.
 *
 * الإنشاء: is_active بيتفرض false من السيرفر — شوف validateProduct.
 * التعديل: expectedUpdatedAt إلزامي، ولو الحفظة بتفعّل المنتج
 * بتمر على نفس شروط الجاهزية بتاعة التفعيل المستقل.
 */
export async function saveProduct(input: ProductInput): Promise<MutationResult<AdminProduct>> {
  const creating = input.id === undefined || input.id === null
  const validated = validateProduct(input, creating ? 'create' : 'update')
  if (!validated.ok) return validated

  try {
    if (creating) {
      const rows = await restInsert<ProductRow>(TABLE, validated.columns, RETURN_COLUMNS)
      const row = rows[0]
      if (!row) return toInternalFailure(null)
      // منتج جديد = مفيش صور بعد، ومخفي بالإجبار
      return { ok: true, data: toAdminProduct(row, 0) }
    }

    const id = wholeNumber(input.id, 'معرّف المنتج')
    if (!id.ok) return id

    const stamp = timestamp(input.expectedUpdatedAt, 'طابع آخر تعديل')
    if (!stamp.ok) return stamp

    /**
     * ⚠️ الثغرة اللي القاعدة دي بتقفلها:
     * من غيرها كان ينفع تتخطى setProductVisibility بالكامل وتفعّل
     * منتج ناقص من خلال حفظ عادي فيه is_active = true.
     */
    if (validated.columns.is_active) {
      const readiness = await incomingReadiness(
        id.value,
        validated.columns.description_ar,
        validated.columns.short_benefit,
      )
      if (!readiness.ok) return readiness
    }

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

/**
 * إظهار أو إخفاء منتج.
 *
 * التفعيل بيتطلب جاهزية كاملة. الإخفاء **مالوش أي شروط** — إخفاء
 * منتج ناقص لازم يفضل ممكن دايمًا، وأي شرط عليه كان هيحبس منتج
 * غلط ظاهر في المتجر.
 */
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
    if (visible.value) {
      const readiness = await storedReadiness(id.value)
      if (!readiness.ok) return readiness
    }

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
