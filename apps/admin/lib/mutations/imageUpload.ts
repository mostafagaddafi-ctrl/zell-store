import 'server-only'

import type { AdminImage } from '../adminData'
import { imageBucket, projectUrl, restDelete, restGet, restInsert, restRpc, storageDelete, storageUpload } from '../data/client'
import { toAdminImage, type ProductImageRow } from '../data/rows'
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
 *   فشل الإدخال          -> امسح الملف
 *   فشل نداء الرئيسية     -> امسح الصف، وبعدين امسح الملف
 *   فشل أي تنظيف          -> storage_orphans لو أمكن، وبرجّع INTERNAL
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

type ProductNameRow = { id: number; name_ar: string }
type CountRow = { id: string }

/** مسح الملف، ولو فشل سجّله orphan. */
async function discardObject(objectPath: string): Promise<'clean' | 'orphaned' | 'stuck'> {
  try {
    await storageDelete(objectPath)
    return 'clean'
  } catch {
    try {
      await restInsert('storage_orphans', {
        bucket: imageBucket(),
        object_path: objectPath,
        reason: 'insert_failed',
      })
      return 'orphaned'
    } catch {
      return 'stuck'
    }
  }
}

export async function uploadProductImage(args: {
  productId: number
  kind: unknown
  altText: unknown
  bytes: Uint8Array
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

    if (!inserted) {
      const cleanup = await discardObject(objectPath)
      if (cleanup === 'clean') return fail(500, 'INTERNAL', 'فشل تسجيل الصورة، والملف اتشال. جرّب تاني.')
      return fail(500, 'INTERNAL', 'فشل تسجيل الصورة. اعمل تحديث للصفحة وراجع صور المنتج.')
    }

    const imageId = String(inserted.id)

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
        let rowRemoved = false
        try {
          await restDelete('product_images', 'id=eq.' + encodeURIComponent(imageId))
          rowRemoved = true
        } catch {
          rowRemoved = false
        }

        /**
         * ⚠️ لو الصف ما اتمسحش، **ممنوع** نسجّل الملف كـ orphan:
         * الصف لسه بيشاور عليه، وأي تنظيف جاي كان هيمسح ملف مستخدم
         * ويسيب صف مكسور. الحالة الحالية (صف + ملف، بلا رئيسية)
         * متسقة وبتتعافى مع أول رفعة جاية.
         */
        if (!rowRemoved) {
          return fail(500, 'INTERNAL', 'الصورة اترفعت بس تعيينها رئيسية فشل. اعمل تحديث للصفحة وراجع صور المنتج.')
        }

        await discardObject(objectPath)
        return fail(500, 'INTERNAL', 'فشل تعيين الصورة رئيسية، والرفع اتلغى. جرّب تاني.')
      }
    }

    // ٩) القراءة تاني — النجاح لازم يعكس الحالة المخزّنة فعلًا
    const stored = await restGet<ProductImageRow>(
      'product_images',
      'select=id,product_id,bucket,object_path,kind,alt_text,fit,sort_order,is_primary,width_px,height_px,updated_at&id=eq.' +
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
