import 'server-only'

import type { AdminImage } from '../adminData'
import { imageBucket, projectUrl, restDelete, restGet, restInsert, restRpc, storageDelete, storageUpload } from '../data/client'
import { toAdminImage, type ProductImageRow } from '../data/rows'
import { exactImageId } from '../images/imageId'
import { afterInsertUnconfirmed, afterPrimaryUnconfirmed, type RollbackDeps } from '../images/uploadRollback'
import type { MutationResult } from '../mutations'
import { detectImage } from '../uploads/imageType'
import { readImageDimensions } from '../uploads/imageSize'
import { toInternalFailure } from './errors'

/**
 * رفع صورة منتج.
 *
 * ⚠️ الرفع على Storage والإدخال في الداتابيز ونداء الرئيسية **تلاتة
 * أنظمة مختلفة، مش معاملة واحدة**. عشان كده في سلّم تراجع صريح:
 *
 *   فشل الإدخال أو ضياع رده -> الملف مايتمسحش أبدًا؛ تسجيل insert_failed بس (IMAGE-DELETE §٥-د)
 *   فشل نداء الرئيسية       -> DELETE مشروط بـ is_primary = false؛ صف واحد بالظبط = امسح الملف (§٥-ج)
 *   فشل أي تنظيف            -> storage_orphans لو أمكن، وبرجّع INTERNAL
 *   السلّم نفسه منطق خالص في lib/images/uploadRollback.ts (والحالات في images.cases.ts).
 *
 * النجاح **مابيترجعش** غير بعد ما الصف يتقرا تاني ويكون فيه حالة
 * الرئيسية والـ fit المخزّنة فعلًا.
 *
 * ملاحظة موثّقة: لو المنتج عنده صور gallery **من غير رئيسية**، الصورة
 * الجديدة بتبقى الرئيسية. ده تعافي مقصود من حالة ناقصة، مش صدفة.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_GALLERY = 10
const SET_PRIMARY_RPC = 'zell_set_primary_product_image'

export type ImageKind = 'gallery' | 'before' | 'after'

export type UploadOutcome = { status: number; result: MutationResult<AdminImage> }

function fail(status: number, code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL' | 'STORAGE_ERROR', message: string): UploadOutcome {
  return { status, result: { ok: false, code, message } }
}

function isKind(value: unknown): value is ImageKind {
  return value === 'gallery' || value === 'before' || value === 'after'
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

type ProductNameRow = { id: number; name_ar: string }
type CountRow = { id: string }

/** اعتماديات سلّم التراجع: DELETE مشروط · مسح الملف · تسجيل insert_failed (نفس الصلاحية الموجودة لمسار الرفع على السيرفر). */
const rollbackDeps: RollbackDeps = {
  deleteRows: async (query) => (await restDelete<{ id: string }>('product_images', query)).length,
  deleteObject: (objectPath) => storageDelete(objectPath),
  recordOrphan: async (objectPath) => {
    await restInsert('storage_orphans', {
      bucket: imageBucket(),
      object_path: objectPath,
      reason: 'insert_failed',
    })
  },
}

export async function uploadProductImage(args: {
  productId: number
  kind: unknown
  altText: unknown
  bytes: Uint8Array<ArrayBuffer>
}): Promise<UploadOutcome> {
  if (!isKind(args.kind)) return fail(400, 'VALIDATION', 'نوع الصورة غير معروف.')
  const kind: ImageKind = args.kind

  if (!Number.isInteger(args.productId) || args.productId <= 0) {
    return fail(400, 'VALIDATION', 'معرّف المنتج غير صالح.')
  }

  // file.size هو المرجع الحقيقي للحجم — مش content-length
  if (args.bytes.byteLength === 0) return fail(400, 'VALIDATION', 'الملف فاضي.')
  if (args.bytes.byteLength > MAX_FILE_BYTES) {
    return fail(413, 'VALIDATION', 'أقصى حجم للصورة ٥ ميجابايت.')
  }

  const detected = detectImage(args.bytes)
  if (!detected) {
    return fail(415, 'VALIDATION', 'الصورة لازم تكون JPEG أو PNG أو WebP أو AVIF.')
  }

  const alt = typeof args.altText === 'string' ? args.altText.trim() : ''
  if (alt.length > 300) return fail(400, 'VALIDATION', 'نص البديل أطول من المسموح (٣٠٠ حرف).')

  try {
    const checksum = await sha256Hex(args.bytes)

    // ١) المنتج موجود؟
    const found = await restGet<ProductNameRow>(
      'products',
      'select=id,name_ar&id=eq.' + String(args.productId) + '&limit=1',
    )
    const product = found.rows[0]
    if (!product) return fail(404, 'NOT_FOUND', 'المنتج مش موجود.')

    // ٢) نفس الصورة مرفوعة على نفس المنتج؟ (فهرس فريد على product_id + checksum)
    const duplicate = await restGet<CountRow>(
      'product_images',
      'select=id&product_id=eq.' + String(args.productId) + '&checksum=eq.' + checksum + '&limit=1',
    )
    if (duplicate.rows.length > 0) {
      return fail(409, 'CONFLICT', 'الصورة دي مرفوعة بالفعل على المنتج ده.')
    }

    // ٣) حدود النوع
    const sameKind = await restGet<{ id: string; sort_order: number }>(
      'product_images',
      'select=id,sort_order&product_id=eq.' + String(args.productId) + '&kind=eq.' + kind + '&order=sort_order.desc&limit=' + String(MAX_GALLERY + 1),
    )

    if (kind === 'gallery' && sameKind.rows.length >= MAX_GALLERY) {
      return fail(409, 'CONFLICT', 'أقصى عدد صور للمنتج هو ' + String(MAX_GALLERY) + '.')
    }
    if (kind !== 'gallery' && sameKind.rows.length > 0) {
      return fail(409, 'CONFLICT', 'في صورة من النوع ده بالفعل. الاستبدال لسه ما اتعملش.')
    }

    const highest = sameKind.rows[0]
    const sortOrder = highest === undefined ? 0 : highest.sort_order + 1

    // ٤) في رئيسية للمنتج ده؟
    const primary = await restGet<CountRow>(
      'product_images',
      'select=id&product_id=eq.' + String(args.productId) + '&is_primary=is.true&limit=1',
    )
    const needsPrimary = kind === 'gallery' && primary.rows.length === 0

    // ٥) المسار بيتبنى في السيرفر — UUID، ومفيش أي جزء من اسم الملف الأصلي
    const objectPath = 'products/' + String(args.productId) + '/' + crypto.randomUUID() + '.' + detected.extension
    const dimensions = readImageDimensions(args.bytes)

    // ٦) الرفع. لو فشل: مفيش صف اتكتب، مفيش تراجع مطلوب.
    try {
      await storageUpload(objectPath, args.bytes, detected.contentType)
    } catch {
      return fail(500, 'STORAGE_ERROR', 'فشل رفع الصورة. جرّب تاني.')
    }

    // ٧) الإدخال. الرئيسية **مش** بتتحدد هنا — الدالة هي اللي بتعمل ده.
    let inserted: ProductImageRow | undefined
    try {
      const rows = await restInsert<ProductImageRow>(
        'product_images',
        {
          product_id: args.productId,
          bucket: imageBucket(),
          object_path: objectPath,
          kind,
          alt_text: alt === '' ? null : alt,
          sort_order: sortOrder,
          is_primary: false,
          fit: 'contain',
          width_px: dimensions.width,
          height_px: dimensions.height,
          bytes: args.bytes.byteLength,
          content_type: detected.contentType,
          checksum,
        },
        'id',
      )
      inserted = rows[0]
    } catch {
      inserted = undefined
    }

    /**
     * ⚠️ فشل الإدخال هنا ممكن يكون رد ضايع لإدخال اتعمل له commit: الصف موجود، ودالة الحذف (0026) ممكن تكون رقّته
     * رئيسية. فالملف **مايتمسحش أبدًا** — تسجيل insert_failed بس (IMAGE-CLEANUP بيفحص المرجع قبل أي مسح).
     */
    if (!inserted) {
      const rollback = await afterInsertUnconfirmed(objectPath, rollbackDeps)
      return fail(500, 'INTERNAL', rollback.message)
    }

    /**
     * IMAGE-DELETE B1: المعرّف بيرجع رقم JSON. لو برّه المدى الآمن بيكون مقرّب، فممكن يشاور على صورة تانية في نفس المنتج.
     * معرّف مش دقيق = نتيجة إدخال غير مؤكدة: مفيش نداء رئيسية ولا حذف صف ولا ملف بيه، تسجيل الملف بس (§٥-د).
     */
    const imageId = exactImageId(inserted.id)
    if (imageId === null) {
      const rollback = await afterInsertUnconfirmed(objectPath, rollbackDeps)
      return fail(500, 'INTERNAL', rollback.message)
    }

    // ٨) الرئيسية — جوه معاملة واحدة بأقفال FOR UPDATE
    if (needsPrimary) {
      let promoted = false
      try {
        const changedAt = await restRpc<string | null>(SET_PRIMARY_RPC, {
          p_product_id: args.productId,
          p_image_id: imageId,
        })
        promoted = changedAt !== null
      } catch {
        promoted = false
      }

      /**
       * فشل التعيين = فشل الرفع كله.
       * ممنوع نرجّع نجاح ونسيب معرض بلا رئيسية.
       */
      if (!promoted) {
        /**
         * ⚠️ فشل وصول الرد مابيثبتش فشل التعيين: لو اتعمل له commit، الصورة دي بقت الرئيسية، والمنتج ممكن يتفعّل عليها.
         * عشان كده الحذف جملة واحدة مشروطة (id + is_primary = false): بتمسح صفر لو التعيين حصل، وبتستنى قفله لو لسه شغّال.
         * الملف بيتمسح بس لو صف واحد بالظبط اتمسح بالشرط ده. أي عدد تاني = مفيش لمس للملف ولا تسجيل
         * (الصف لسه بيشاور عليه، والحالة متسقة وبتظهر بعد إعادة القراية).
         */
        const rollback = await afterPrimaryUnconfirmed(imageId, objectPath, rollbackDeps)
        return fail(500, 'INTERNAL', rollback.message)
      }
    }

    // ٩) القراءة تاني — النجاح لازم يعكس الحالة المخزّنة فعلًا
    const stored = await restGet<ProductImageRow>(
      'product_images',
      'select=id::text,product_id,bucket,object_path,kind,alt_text,fit,sort_order,is_primary,width_px,height_px,updated_at&id=eq.' +
        encodeURIComponent(imageId) +
        '&limit=1',
    )
    const row = stored.rows[0]
    if (!row) return fail(500, 'INTERNAL', 'الصورة اترفعت بس قراءتها فشلت. اعمل تحديث للصفحة.')

    const image = toAdminImage(row, projectUrl(), product.name_ar)
    return { status: 200, result: { ok: true, data: image } }
  } catch (error) {
    return { status: 500, result: toInternalFailure(error) }
  }
}
