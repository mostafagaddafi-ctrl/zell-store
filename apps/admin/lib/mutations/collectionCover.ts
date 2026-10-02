import 'server-only'

import type { AdminCollection } from '../adminData'
import { imageBucket, restGet, restInsert, restRpc, storageDelete, storageUpload } from '../data/client'
import type { MutationResult } from '../mutations'
import { readImageDimensions } from '../uploads/imageSize'
import { detectImage } from '../uploads/imageType'
import { validateCollectionId } from '../validation/collection'
import { readAdminCollection } from './collections'
import { toInternalFailure } from './errors'

/**
 * صورة غلاف القسم (0012).
 *
 * نفس سلّم التراجع بتاع صور الموقع — Storage والداتابيز **نظامين
 * مختلفين مش معاملة واحدة**:
 *
 *   فشل الرفع           -> مفيش حاجة اتكتبت
 *   فشل تسجيل الغلاف     -> نقرا الصف: لو مش بيشاور على الملف الجديد،
 *                          امسح الملف (أو سجّله orphan لو المسح فشل)
 *
 * ⚠️ الملف القديم **مابيتمسحش هنا**. zell_set_collection_cover بتسجّله
 *    في storage_orphans جوه نفس المعاملة اللي بتبدّل الغلاف.
 *
 * ⚠️ النوع من **البايتات** مش من اسم الملف ولا MIME المتصفح، والأبعاد
 *    المجهولة مرفوضة. SVG مرفوض بالتصميم (detectImage مابتعرفهوش).
 *    الواجهة بتضغط WebP قبل الرفع، والتحقق هنا إلزامي في كل الحالات.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024
const CONTENT_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']
const MIN_WIDTH = 600
const MIN_HEIGHT = 300
const MAX_EDGE = 8000
const COVER_RPC = 'zell_set_collection_cover'
const COLLECTION_GONE = 'القسم مش موجود. يمكن يكون اتمسح.'

export type CoverOutcome = { status: number; result: MutationResult<AdminCollection> }

function fail(
  status: number,
  code: 'VALIDATION' | 'NOT_FOUND' | 'INTERNAL' | 'STORAGE_ERROR',
  message: string,
): CoverOutcome {
  return { status, result: { ok: false, code, message } }
}

/** مسح الملف، ولو فشل سجّله orphan. */
async function discardObject(objectPath: string): Promise<void> {
  try {
    await storageDelete(objectPath)
  } catch {
    try {
      await restInsert('storage_orphans', {
        bucket: imageBucket(),
        object_path: objectPath,
        reason: 'insert_failed',
      })
    } catch {
      // الملف هيفضل من غير صف بيشاور عليه — مش ظاهر في أي مكان
    }
  }
}

async function currentCoverPath(collectionId: string): Promise<string | null | undefined> {
  const rows = await restGet<{ cover_object_path: string | null }>(
    'collections',
    'select=cover_object_path&id=eq.' + encodeURIComponent(collectionId) + '&limit=1',
  )
  const row = rows.rows[0]
  return row === undefined ? undefined : row.cover_object_path
}

export async function uploadCollectionCover(args: {
  collectionId: unknown
  bytes: Uint8Array<ArrayBuffer>
}): Promise<CoverOutcome> {
  const id = validateCollectionId(args.collectionId)
  if (!id.ok) return { status: 400, result: id }

  if (args.bytes.byteLength === 0) return fail(400, 'VALIDATION', 'الملف فاضي.')
  if (args.bytes.byteLength > MAX_FILE_BYTES) {
    return fail(413, 'VALIDATION', 'أقصى حجم للصورة ٥ ميجابايت.')
  }

  const detected = detectImage(args.bytes)
  if (!detected || !CONTENT_TYPES.includes(detected.contentType)) {
    return fail(415, 'VALIDATION', 'صورة القسم لازم تكون JPEG أو PNG أو WebP.')
  }

  const dimensions = readImageDimensions(args.bytes)
  if (dimensions.width === null || dimensions.height === null) {
    return fail(400, 'VALIDATION', 'مش قادرين نقرا أبعاد الصورة. صدّرها تاني من برنامج الصور وجرّب.')
  }
  if (dimensions.width < MIN_WIDTH || dimensions.height < MIN_HEIGHT) {
    return fail(400, 'VALIDATION', 'الصورة صغيرة. أقل مقاس ' + String(MIN_WIDTH) + '×' + String(MIN_HEIGHT) + ' بكسل.')
  }
  if (dimensions.width > MAX_EDGE || dimensions.height > MAX_EDGE) {
    return fail(400, 'VALIDATION', 'الصورة كبيرة جدًا. أقصى ضلع ' + String(MAX_EDGE) + ' بكسل.')
  }

  try {
    if ((await currentCoverPath(id.value)) === undefined) return fail(404, 'NOT_FOUND', COLLECTION_GONE)

    // المسار بيتبنى في السيرفر — UUID، ومفيش أي جزء من اسم الملف الأصلي
    const objectPath = 'collections/' + id.value + '/' + crypto.randomUUID() + '.' + detected.extension

    try {
      await storageUpload(objectPath, args.bytes, detected.contentType)
    } catch {
      return fail(500, 'STORAGE_ERROR', 'فشل رفع الصورة. جرّب تاني.')
    }

    try {
      await restRpc<string | null>(COVER_RPC, {
        p_collection_id: id.value,
        p_bucket: imageBucket(),
        p_object_path: objectPath,
        p_width_px: dimensions.width,
        p_height_px: dimensions.height,
      })
    } catch {
      // نكمل للتحقق بالقراءة — النداء ممكن يكون نجح والرد بس اللي ضاع
    }

    // ⚠️ المرجع هو الصف المخزّن، مش رد الدالة
    let stored: string | null | undefined
    try {
      stored = await currentCoverPath(id.value)
    } catch {
      return fail(500, 'INTERNAL', 'الصورة اترفعت بس التأكد من حفظها فشل. اعمل تحديث للصفحة.')
    }

    if (stored !== objectPath) {
      await discardObject(objectPath)
      if (stored === undefined) return fail(404, 'NOT_FOUND', COLLECTION_GONE)
      return fail(500, 'INTERNAL', 'فشل حفظ صورة القسم، والرفع اتلغى. جرّب تاني.')
    }

    const collection = await readAdminCollection(id.value)
    if (!collection) return fail(404, 'NOT_FOUND', COLLECTION_GONE)
    return { status: 200, result: { ok: true, data: collection } }
  } catch (error) {
    return { status: 500, result: toInternalFailure(error) }
  }
}

/** شيل الغلاف — المتجر بيرجع لصورة أول منتج تلقائيًا. */
export async function removeCollectionCover(rawId: unknown): Promise<MutationResult<AdminCollection>> {
  const id = validateCollectionId(rawId)
  if (!id.ok) return id

  try {
    const updated = await restRpc<string | null>(COVER_RPC, {
      p_collection_id: id.value,
      p_bucket: null,
      p_object_path: null,
      p_width_px: null,
      p_height_px: null,
    })
    if (updated === null) return { ok: false, code: 'NOT_FOUND', message: COLLECTION_GONE }

    const collection = await readAdminCollection(id.value)
    if (!collection) return { ok: false, code: 'NOT_FOUND', message: COLLECTION_GONE }
    if (collection.cover !== null) return toInternalFailure(null)
    return { ok: true, data: collection }
  } catch (error) {
    return toInternalFailure(error)
  }
}
