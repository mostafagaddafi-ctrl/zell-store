import 'server-only'

import type { AdminImage } from '../adminData'
import {
  imageBucket,
  projectUrl,
  restDelete,
  restGet,
  restInsert,
  restRpc,
  storageDelete,
  storageUpload,
} from '../data/client'
import { toAdminSiteImage, type SiteImageRow } from '../data/rows'
import type { ImageFit } from '../enums'
import type { MutationResult } from '../mutations'
import { readImageDimensions } from '../uploads/imageSize'
import { detectImage } from '../uploads/imageType'
import { toInternalFailure } from './errors'

/**
 * رفع صورة موقع (اللوجو / صورة الواجهة).
 *
 * نفس سلّم التراجع بتاع صور المنتجات — Storage والداتابيز **نظامين
 * مختلفين مش معاملة واحدة**:
 *
 *   فشل الإدخال       -> امسح الملف الجديد
 *   فشل التفعيل        -> امسح الصف الجديد، وبعدين امسح ملفه
 *   فشل أي تنظيف       -> storage_orphans لو أمكن، وبرجّع INTERNAL
 *
 * ⚠️ الصف بيتدخّل **is_active = false**، والتفعيل بيحصل جوه
 *    zell_activate_site_image. ممنوع ندخّل صف نشط من هنا: الفهرس
 *    الفريد (0009) بيمنع نشطين لنفس النوع، فإدخال نشط مباشرة كان
 *    هيفشل طول ما في صورة قديمة نشطة.
 *
 * ⚠️ التسلسل بين رفعتين متزامنتين مسؤولية **advisory transaction
 *    lock** لكل نوع جوه الدالة — مش FOR UPDATE، اللي مابيقفلش حاجة
 *    لو النوع لسه مالوش أي صفوف (أول رفعة hero). التفاصيل في 0009.
 *
 * ⚠️ **الملف القديم مابيتمسحش هنا ولا في الدالة.** الدالة بتسجّله في
 *    storage_orphans بـ reason = 'replaced' وبتشيل صفّه، فالثابت
 *    «كل صف بيشاور على ملف حيّ» بيفضل صحيح، والحذف الفعلي شغل
 *    التنظيف المنفصل.
 */

export type SiteImageKind = 'logo' | 'hero'

/** حد السيرفر. الواجهة بترفض على ٤ عشان حد المنصة — دفاع تاني. */
const MAX_FILE_BYTES = 5 * 1024 * 1024
const ACTIVATE_RPC = 'zell_activate_site_image'

type KindRules = {
  contentTypes: readonly string[]
  typesMessage: string
  folder: string
  fit: ImageFit
  fallbackAlt: string
  minWidth: number
  minHeight: number
  maxEdge: number
}

/**
 * ⚠️ SVG **مرفوض بالتصميم**، مش بالسهو: ملف SVG ممكن يحتوي سكربت،
 *    وهو بيتقدّم من نفس الـ origin بتاع الملفات العامة. detectImage
 *    أصلاً مابتعرفش SVG، والقايمة دي طبقة تانية فوقها.
 *
 * ⚠️ AVIF مرفوض للوجو تحديدًا — دعم المتصفحات أقل، واللوجو بيظهر في
 *    كل صفحة فمش المكان المناسب للمجازفة.
 */
const RULES: Record<SiteImageKind, KindRules> = {
  logo: {
    contentTypes: ['image/png', 'image/webp'],
    typesMessage: 'اللوجو لازم يكون PNG أو WebP بخلفية شفافة.',
    folder: 'branding/logo',
    fit: 'contain',
    fallbackAlt: 'شعار المتجر',
    minWidth: 64,
    minHeight: 24,
    maxEdge: 4000,
  },
  hero: {
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    typesMessage: 'صورة الواجهة لازم تكون JPEG أو PNG أو WebP.',
    folder: 'branding/hero',
    fit: 'cover',
    fallbackAlt: 'صورة الواجهة',
    minWidth: 800,
    minHeight: 450,
    maxEdge: 8000,
  },
}

export type SiteImageOutcome = { status: number; result: MutationResult<AdminImage> }

function fail(
  status: number,
  code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL' | 'STORAGE_ERROR',
  message: string,
): SiteImageOutcome {
  return { status, result: { ok: false, code, message } }
}

export function isSiteImageKind(value: unknown): value is SiteImageKind {
  return value === 'logo' || value === 'hero'
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

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

export async function uploadSiteImage(args: {
  kind: unknown
  altText: unknown
  bytes: Uint8Array<ArrayBuffer>
}): Promise<SiteImageOutcome> {
  if (!isSiteImageKind(args.kind)) return fail(400, 'VALIDATION', 'نوع الصورة غير معروف.')
  const kind: SiteImageKind = args.kind
  const rules = RULES[kind]

  if (args.bytes.byteLength === 0) return fail(400, 'VALIDATION', 'الملف فاضي.')
  if (args.bytes.byteLength > MAX_FILE_BYTES) {
    return fail(413, 'VALIDATION', 'أقصى حجم للصورة ٥ ميجابايت.')
  }

  // النوع من **البايتات** — الاسم و MIME الجاي من المتصفح بيتجاهلوا
  const detected = detectImage(args.bytes)
  if (!detected || !rules.contentTypes.includes(detected.contentType)) {
    return fail(415, 'VALIDATION', rules.typesMessage)
  }

  const alt = typeof args.altText === 'string' ? args.altText.trim() : ''
  if (alt.length > 300) return fail(400, 'VALIDATION', 'النص البديل أطول من المسموح (٣٠٠ حرف).')

  /**
   * ⚠️ هنا **بنرفض** الأبعاد المجهولة، عكس صور المنتجات.
   *    لصور المنتجات الأبعاد بيانات وصفية، لكن اللوجو وصورة الواجهة
   *    ليهم متطلبات تخطيط صريحة وبيظهروا في كل صفحة. وهما صورتين بس
   *    في الموقع كله، فرفض خاطئ تكلفته إعادة تصدير الملف — أرخص
   *    بكتير من لوجو مشوّه أمام كل زائر.
   */
  const dimensions = readImageDimensions(args.bytes)
  if (dimensions.width === null || dimensions.height === null) {
    return fail(400, 'VALIDATION', 'مش قادرين نقرا أبعاد الصورة. صدّرها تاني من برنامج الصور وجرّب.')
  }
  if (dimensions.width < rules.minWidth || dimensions.height < rules.minHeight) {
    return fail(
      400,
      'VALIDATION',
      'الصورة صغيرة. أقل مقاس ' + String(rules.minWidth) + '×' + String(rules.minHeight) + ' بكسل.',
    )
  }
  if (dimensions.width > rules.maxEdge || dimensions.height > rules.maxEdge) {
    return fail(400, 'VALIDATION', 'الصورة كبيرة جدًا. أقصى ضلع ' + String(rules.maxEdge) + ' بكسل.')
  }

  try {
    const checksum = await sha256Hex(args.bytes)

    // نفس الملف بالظبط مرفوع ونشط؟ مفيش داعي لنسخة تانية
    const duplicate = await restGet<{ id: string }>(
      'site_images',
      'select=id&kind=eq.' + kind + '&checksum=eq.' + checksum + '&is_active=eq.true&limit=1',
    )
    if (duplicate.rows.length > 0) {
      return fail(409, 'CONFLICT', 'الصورة دي مستخدمة بالفعل.')
    }

    // المسار بيتبنى في السيرفر — UUID، ومفيش أي جزء من اسم الملف الأصلي
    const objectPath = rules.folder + '/' + crypto.randomUUID() + '.' + detected.extension

    try {
      await storageUpload(objectPath, args.bytes, detected.contentType)
    } catch {
      return fail(500, 'STORAGE_ERROR', 'فشل رفع الصورة. جرّب تاني.')
    }

    // الصف بيتدخّل **غير نشط** — التفعيل شغل الدالة
    let insertedId: string | undefined
    try {
      const inserted = await restInsert<{ id: string }>(
        'site_images',
        {
          kind,
          bucket: imageBucket(),
          object_path: objectPath,
          alt_text: alt === '' ? null : alt,
          sort_order: 0,
          is_active: false,
          width_px: dimensions.width,
          height_px: dimensions.height,
          bytes: args.bytes.byteLength,
          content_type: detected.contentType,
          checksum,
        },
        'id',
      )
      insertedId = inserted[0]?.id
    } catch {
      insertedId = undefined
    }

    if (insertedId === undefined) {
      const cleanup = await discardObject(objectPath)
      if (cleanup === 'clean') return fail(500, 'INTERNAL', 'فشل تسجيل الصورة، والملف اتشال. جرّب تاني.')
      return fail(500, 'INTERNAL', 'فشل تسجيل الصورة. اعمل تحديث للصفحة وراجع الصور.')
    }

    // التبديل الذرّي: القديم يتسجّل orphan ويتشال، والجديد يبقى نشط
    let activated = false
    try {
      const returned = await restRpc<string | number | null>(ACTIVATE_RPC, {
        p_kind: kind,
        p_image_id: insertedId,
      })
      activated = returned !== null && returned !== undefined
    } catch {
      activated = false
    }

    if (!activated) {
      /**
       * ⚠️ العدد هو المرجع، **مش** كود حالة الـ DELETE — نفس درس صور
       *    المنتجات. DELETE ناجح ممكن يمسح صفر صفوف، ولو اعتبرناه
       *    نجاح هنمسح ملف لصف لسه حيّ.
       */
      let removed = -1
      try {
        const rowsOut = await restDelete<{ id: string }>(
          'site_images',
          'id=eq.' + encodeURIComponent(insertedId),
        )
        removed = rowsOut.length
      } catch {
        removed = -1
      }

      if (removed !== 1) {
        // الصف لسه بيشاور على الملف — ممنوع نلمسه. الحالة متسقة:
        // صورة غير نشطة مش ظاهرة في أي مكان.
        return fail(500, 'INTERNAL', 'الصورة اترفعت بس تفعيلها فشل، والتنظيف ما تمّش. اعمل تحديث للصفحة.')
      }

      await discardObject(objectPath)
      return fail(500, 'INTERNAL', 'فشل تفعيل الصورة، والرفع اتلغى. جرّب تاني.')
    }

    // القراءة تاني — النجاح لازم يعكس الحالة المخزّنة فعلًا
    const stored = await restGet<SiteImageRow>(
      'site_images',
      'select=id,bucket,object_path,kind,alt_text,width_px,height_px,updated_at&id=eq.' +
        encodeURIComponent(insertedId) +
        '&is_active=eq.true&limit=1',
    )
    const row = stored.rows[0]
    if (!row) return fail(500, 'INTERNAL', 'الصورة اترفعت بس قراءتها فشلت. اعمل تحديث للصفحة.')

    return {
      status: 200,
      result: { ok: true, data: toAdminSiteImage(row, projectUrl(), rules.fallbackAlt, rules.fit) },
    }
  } catch (error) {
    return { status: 500, result: toInternalFailure(error) }
  }
}
