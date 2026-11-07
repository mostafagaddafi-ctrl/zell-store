/**
 * IMAGE-DELETE (C1) — سلّم التراجع في رفع صورة المنتج بعد العقد (docs/contracts/IMAGE-DELETE.md §٥-ج و§٥-د).
 * منطق خالص، والاعتماديات (REST وStorage) بتتحقن من lib/mutations/imageUpload.ts.
 *
 * الضمان: مسار الرفع **مابيمسحش ملف من Storage غير في حالة واحدة**: جملة DELETE المشروطة
 * (id = الصورة الجديدة and is_primary = false) في نفس الطلب مسحت **صف واحد بالظبط**. القيد
 * product_images_object_unique بيضمن إن مفيش صف تاني بيشاور على نفس المسار، والمسار UUID اتعمل في نفس الطلب.
 *
 *   فشل الإدخال أو ضياع رده      -> الملف مايتمسحش أبدًا؛ تسجيل insert_failed بس (ولو التسجيل فشل: الملف بيفضل من غير سجل).
 *   فشل تعيين الرئيسية أو ضياع رده -> DELETE مشروط بـ is_primary = false؛ صف واحد بالظبط = مسح الملف (ولو فشل: تسجيله)،
 *                                   غير كده = مفيش لمس للملف ولا تسجيل.
 *
 * ليه: فشل وصول الرد مابيثبتش فشل المعاملة. لو التعيين اتعمل له commit، أو دالة الحذف (0026) رقّت الصورة الجديدة
 * بعد ما إدخالها اتعمل له commit، مسح الصف أو الملف كان هيسيب منتج ظاهر رئيسيته مش موجودة أو بتشاور على ملف ممسوح.
 */

export const INSERT_UNCONFIRMED_MESSAGE = 'تعذّر تأكيد حفظ الصورة. حدِّث الصفحة وراجع صور المنتج قبل إعادة الرفع.'
/** نصوص فرع الرئيسية زي ما هي قبل C1 (العقد §٧: مفيش أي تغيير تاني في السلّم). */
export const PRIMARY_CLEANUP_INCOMPLETE_MESSAGE =
  'الصورة اترفعت بس تعيينها رئيسية فشل، والتنظيف ما تمّش. اعمل تحديث للصفحة وراجع صور المنتج.'
export const PRIMARY_UPLOAD_CANCELLED_MESSAGE = 'فشل تعيين الصورة رئيسية، والرفع اتلغى. جرّب تاني.'

/** شرط REST لجملة الحذف المشروطة (§٥-ج): الشرط بيتفحص جوه نفس الجملة اللي بتمسح، من غير قراية قبلها. */
export function nonPrimaryDeleteQuery(imageId: string): string {
  return 'id=eq.' + encodeURIComponent(imageId) + '&is_primary=is.false'
}

export type RollbackDeps = {
  /** DELETE على product_images بالشرط ده، وبيرجّع عدد الصفوف الممسوحة. أي فشل = استثناء. */
  deleteRows: (query: string) => Promise<number>
  /** مسح ملف من Storage. أي فشل = استثناء. */
  deleteObject: (objectPath: string) => Promise<void>
  /** تسجيل المسار في storage_orphans بسبب insert_failed. أي فشل = استثناء. */
  recordOrphan: (objectPath: string) => Promise<void>
}

/** deleted = الملف اتمسح · recorded = اتسجّل للتنظيف · kept = فضل زي ما هو من غير سجل. */
export type RollbackFile = 'deleted' | 'recorded' | 'kept'

export type RollbackResult = { message: string; removedRows: number; file: RollbackFile }

async function recordOnly(objectPath: string, deps: Pick<RollbackDeps, 'recordOrphan'>): Promise<RollbackFile> {
  try {
    await deps.recordOrphan(objectPath)
    return 'recorded'
  } catch {
    return 'kept'
  }
}

/** §٥-د: الإدخال فشل أو رده ضاع. مفيش مسح ملف في أي حالة، تسجيل بس. */
export async function afterInsertUnconfirmed(
  objectPath: string,
  deps: Pick<RollbackDeps, 'recordOrphan'>,
): Promise<RollbackResult> {
  return { message: INSERT_UNCONFIRMED_MESSAGE, removedRows: 0, file: await recordOnly(objectPath, deps) }
}

/**
 * §٥-ج: تعيين الرئيسية فشل أو رده ضاع. العدد هو المرجع مش كود حالة الـ DELETE: -1 = النداء نفسه فشل،
 * صفر = الصورة غالبًا اتعيّنت رئيسية فعلًا (أو اتحذفت بدالة الحذف)، أكتر من 1 = مستحيل مع مفتاح أساسي.
 * في كل الحالات دي الملف مايتلمسش ومايتسجّلش.
 */
export async function afterPrimaryUnconfirmed(
  imageId: string,
  objectPath: string,
  deps: RollbackDeps,
): Promise<RollbackResult> {
  let removed = -1
  try {
    removed = await deps.deleteRows(nonPrimaryDeleteQuery(imageId))
  } catch {
    removed = -1
  }
  if (removed !== 1) return { message: PRIMARY_CLEANUP_INCOMPLETE_MESSAGE, removedRows: removed, file: 'kept' }

  // صف واحد بالظبط اتمسح بالشرط — دلوقتي بس ينفع نمسح الملف
  let file: RollbackFile = 'deleted'
  try {
    await deps.deleteObject(objectPath)
  } catch {
    file = await recordOnly(objectPath, deps)
  }
  return { message: PRIMARY_UPLOAD_CANCELLED_MESSAGE, removedRows: 1, file }
}
