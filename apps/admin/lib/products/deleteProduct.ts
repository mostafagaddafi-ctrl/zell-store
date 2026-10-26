/**
 * PRODUCT-DELETE (المرحلة B) — حذف المنتج نهائيًا من صفحة المنتج. منطق خالص (العقد docs/contracts/PRODUCT-DELETE.md §٦).
 *
 * القراية zell_product_delete_preview والحذف zell_product_delete (0022) بجلسة المستخدم، والقرار النهائي في الداتابيز:
 * المالك بس (45402) · المنتج مخفي (45503) · من غير طلبات (45504) ولا مخزون (45505) · النسخة (45502) · قفل مشغول (45508).
 * أعداد المعاينة معلومة لحظة قرايتها بس، والحذف بيعيد كل الفحوص على الحالة الحالية.
 * ومعاها ربط 45507 (trigger قايمة الرئيسية) في حفظ الرئيسية، وقرار الكارت بعد الحذف (التحذير لو تحديث المتجر فشل).
 *
 * نصوص اللوحة الجديدة بالفصحى المبسّطة الرسمية (العقد §٦).
 */

import type { MutationErrorCode } from '../mutations'

export type ProductDeletePreview = {
  productId: number
  isActive: boolean
  updatedAt: string
  hasOrders: boolean
  hasStock: boolean
  orphanConflict: boolean
  images: number
  widths: number
  addons: number
  usedAsAddonIn: number
  collections: number
  inHome: boolean
  canDelete: boolean
}

export type ProductDeleteResult = {
  productId: number
  imagesRegistered: number
  imagesAlreadyPending: number
  removedFromHome: boolean
  addonLinks: number
  collectionLinks: number
}

export const PRODUCT_DELETE_TEXT = {
  title: 'حذف المنتج نهائيًا',
  hideFirst: 'أخفِ المنتج أولًا لإتاحة الحذف.',
  intro: 'يحذف المنتج وكل ما يتبعه: الصور والعروض وروابط الإضافات والأقسام، ويُزال من الصفحة الرئيسية. لا يمكن التراجع عن الحذف.',
  storageNote: 'ملفات الصور لا تُحذف من التخزين الآن، بل تُسجَّل لتنظيفها لاحقًا.',
  snapshotNote: 'هذه الأعداد وقت فتح الصفحة، ويُعاد فحص كل الشروط عند الحذف.',
  unavailable: 'تعذّر تحميل بيانات الحذف الآن. حدّث الصفحة وحاول مرة أخرى.',
  button: 'حذف المنتج',
  confirmTitle: 'تأكيد الحذف النهائي',
  confirm: 'نعم، احذف المنتج نهائيًا',
  cancel: 'إلغاء',
  deleting: 'جارٍ الحذف…',
  deleted: 'تم حذف المنتج.',
  backToList: 'العودة إلى قائمة المنتجات',
} as const

export const PRODUCT_DELETE_BLOCKERS = {
  visible: 'المنتج ظاهر في المتجر. أخفِه أولًا ثم احذفه.',
  orders: 'لا يمكن حذف هذا المنتج لأنه موجود في طلب سابق. يمكنك إبقاؤه مخفيًا.',
  stock: 'لا يمكن حذف هذا المنتج لأن له مخزونًا أو مستندات مخزون. يمكنك إبقاؤه مخفيًا.',
  orphanConflict: 'تعذّر حذف هذا المنتج بسبب تعارض في سجل تنظيف الصور. تواصل مع الدعم الفني.',
} as const

export const PRODUCT_DELETE_MESSAGES = {
  unauthenticated: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
  forbidden: 'حذف المنتجات متاح للمالك فقط.',
  notFound: 'المنتج غير موجود، وربما حُذف بالفعل. ارجع إلى قائمة المنتجات.',
  conflict: 'تغيّر المنتج منذ فتح الصفحة. حدّث الصفحة وراجع البيانات ثم حاول مرة أخرى.',
  busy: 'العملية مشغولة الآن. حاول مرة أخرى بعد لحظات.',
  internal: 'تعذّر حذف المنتج. حاول مرة أخرى.',
  invalid: 'بيانات الحذف غير صالحة. حدّث الصفحة وحاول مرة أخرى.',
} as const

/** 45507 من trigger قايمة الرئيسية: الحفظ ضاف id لمنتج مش موجود (اتحذف بعد فتح الصفحة). */
export const HOME_PRODUCTS_MISSING_SENTINEL = 'ZELL_HOME_PRODUCTS_MISSING'
export const HOME_PRODUCTS_MISSING_MESSAGE = 'في القائمة منتج لم يعد موجودًا. حدّث الصفحة ثم احفظ مرة أخرى.'

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** رد zell_product_delete_preview. أي شكل تاني = null («تعذّر التحميل»). */
export function parseProductDeletePreview(raw: unknown): ProductDeletePreview | null {
  if (!isObj(raw)) return null
  const id = raw['product_id']
  const at = raw['updated_at']
  const flags = ['is_active', 'has_orders', 'has_stock', 'orphan_conflict', 'in_home', 'can_delete'].map((k) => raw[k])
  const counts = ['images', 'widths', 'addons', 'used_as_addon_in', 'collections'].map((k) => count(raw[k]))
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
  if (typeof at !== 'string' || at === '') return null
  if (flags.some((f) => typeof f !== 'boolean') || counts.some((c) => c === null)) return null
  const [isActive, hasOrders, hasStock, orphanConflict, inHome, canDelete] = flags as boolean[]
  const [images, widths, addons, usedAsAddonIn, collections] = counts as number[]
  return {
    productId: id,
    isActive: isActive as boolean,
    updatedAt: at,
    hasOrders: hasOrders as boolean,
    hasStock: hasStock as boolean,
    orphanConflict: orphanConflict as boolean,
    images: images as number,
    widths: widths as number,
    addons: addons as number,
    usedAsAddonIn: usedAsAddonIn as number,
    collections: collections as number,
    inHome: inHome as boolean,
    canDelete: canDelete as boolean,
  }
}

/** رد zell_product_delete. لازم deleted = true ونفس المنتج، وإلا null. */
export function parseProductDeleteResult(raw: unknown, productId: number): ProductDeleteResult | null {
  if (!isObj(raw) || raw['deleted'] !== true || raw['product_id'] !== productId) return null
  const nums = ['images_registered', 'images_already_pending', 'addon_links', 'collection_links'].map((k) => count(raw[k]))
  if (nums.some((n) => n === null) || typeof raw['removed_from_home'] !== 'boolean') return null
  const [imagesRegistered, imagesAlreadyPending, addonLinks, collectionLinks] = nums as number[]
  return {
    productId,
    imagesRegistered: imagesRegistered as number,
    imagesAlreadyPending: imagesAlreadyPending as number,
    removedFromHome: raw['removed_from_home'] as boolean,
    addonLinks: addonLinks as number,
    collectionLinks: collectionLinks as number,
  }
}

/** أسباب منع الحذف بالترتيب (الظهور الأول). فاضية = الزرار متاح. */
export function productDeleteBlockers(preview: ProductDeletePreview): string[] {
  const out: string[] = []
  if (preview.isActive) out.push(PRODUCT_DELETE_BLOCKERS.visible)
  if (preview.hasOrders) out.push(PRODUCT_DELETE_BLOCKERS.orders)
  if (preview.hasStock) out.push(PRODUCT_DELETE_BLOCKERS.stock)
  if (preview.orphanConflict) out.push(PRODUCT_DELETE_BLOCKERS.orphanConflict)
  return out
}

/** الزرار متاح بس لو الداتابيز قالت can_delete ومفيش ولا سبب منع (الاتنين لازم يتفقوا). */
export function productDeleteAllowed(preview: ProductDeletePreview): boolean {
  return preview.canDelete && productDeleteBlockers(preview).length === 0
}

/** سطور الأعداد في الكارت وفي حوار التأكيد. */
export function productDeleteSummary(preview: ProductDeletePreview): string[] {
  const lines = [
    'الصور: ' + String(preview.images),
    'العروض: ' + String(preview.widths),
    'الأقسام: ' + String(preview.collections),
    'الإضافات المرتبطة به: ' + String(preview.addons),
  ]
  if (preview.usedAsAddonIn > 0) lines.push('مستخدم كإضافة في ' + String(preview.usedAsAddonIn) + ' منتج')
  if (preview.inHome) lines.push('موجود في الصفحة الرئيسية')
  return lines
}

/** نص حوار التأكيد. */
export function productDeleteQuestion(name: string, preview: ProductDeletePreview): string {
  return 'سيُحذف «' + name.trim() + '» نهائيًا مع: ' + productDeleteSummary(preview).join('، ') + '. هل تريد المتابعة؟'
}

const SENTINEL_CODES: Readonly<Record<string, string>> = {
  ZELL_ORD_UNAUTHENTICATED: '45400',
  ZELL_ORD_FORBIDDEN: '45401',
  ZELL_ORD_OWNER_ONLY: '45402',
  ZELL_PRODUCT_NOT_FOUND: '45501',
  ZELL_PRODUCT_CONFLICT: '45502',
  ZELL_PRODUCT_VISIBLE: '45503',
  ZELL_PRODUCT_HAS_ORDERS: '45504',
  ZELL_PRODUCT_HAS_STOCK: '45505',
  ZELL_PRODUCT_ORPHAN_CONFLICT: '45506',
  ZELL_PRODUCT_BUSY: '45508',
}

/** كود الخطأ من رد supabase-js: code بصيغة 45xxx، أو اسم معروف في message. */
export function productDeleteErrorCode(error: unknown): string | null {
  if (!isObj(error)) return null
  const code = error['code']
  if (typeof code === 'string' && /^45\d{3}$/.test(code)) return code
  const message = error['message']
  if (typeof message === 'string') {
    for (const [name, value] of Object.entries(SENTINEL_CODES)) {
      if (message === name || message.startsWith(name + ':')) return value
    }
  }
  return null
}

export type ProductDeleteFailure = { code: MutationErrorCode; message: string }

/** تحويل خطأ المعاينة أو الحذف لنتيجة اللوحة. أي حاجة مش معروفة = INTERNAL من غير تفاصيل. */
export function productDeleteFailure(error: unknown, httpStatus: number): ProductDeleteFailure {
  switch (productDeleteErrorCode(error)) {
    case '45400':
      return { code: 'UNAUTHENTICATED', message: PRODUCT_DELETE_MESSAGES.unauthenticated }
    case '45401':
    case '45402':
      return { code: 'FORBIDDEN', message: PRODUCT_DELETE_MESSAGES.forbidden }
    case '45501':
      return { code: 'NOT_FOUND', message: PRODUCT_DELETE_MESSAGES.notFound }
    case '45502':
      return { code: 'CONFLICT', message: PRODUCT_DELETE_MESSAGES.conflict }
    case '45503':
      return { code: 'VALIDATION', message: PRODUCT_DELETE_BLOCKERS.visible }
    case '45504':
      return { code: 'VALIDATION', message: PRODUCT_DELETE_BLOCKERS.orders }
    case '45505':
      return { code: 'VALIDATION', message: PRODUCT_DELETE_BLOCKERS.stock }
    case '45506':
      return { code: 'VALIDATION', message: PRODUCT_DELETE_BLOCKERS.orphanConflict }
    case '45508':
      return { code: 'VALIDATION', message: PRODUCT_DELETE_MESSAGES.busy }
    default:
      if (httpStatus === 401) return { code: 'UNAUTHENTICATED', message: PRODUCT_DELETE_MESSAGES.unauthenticated }
      return { code: 'INTERNAL', message: PRODUCT_DELETE_MESSAGES.internal }
  }
}

/** مدخلات الحذف قبل أي نداء: id موجب صحيح ونسخة نصية مقروءة كتاريخ. */
export function productDeleteInputIssue(productId: unknown, expectedUpdatedAt: unknown): string | null {
  if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) return PRODUCT_DELETE_MESSAGES.invalid
  if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt === '' || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    return PRODUCT_DELETE_MESSAGES.invalid
  }
  return null
}

/** حفظ الرئيسية: 45507 = رسالة تحقق واضحة بدل الخطأ العام. أي رمز تاني = null (الحفظ بيكمّل بسلوكه الحالي). */
export function homeProductsSaveMessage(sentinel: string | null): string | null {
  return sentinel === HOME_PRODUCTS_MISSING_SENTINEL ? HOME_PRODUCTS_MISSING_MESSAGE : null
}

// ── بعد الحذف: تحديث المتجر والتحذير (من غير أي إعادة للحذف) ──────────────────────

/** رسالة رفض غلاف اللوحة لـ deleteProductAction (حارس المالك نفسه، بصلاحية فئة المالك الموجودة). */
export const PRODUCT_DELETE_OWNER_ONLY_MESSAGE = PRODUCT_DELETE_MESSAGES.forbidden

/** الحذف نجح وتحديث المتجر الفوري (/api/revalidate) فشل: نجاح بتحذير، مش فشل حذف. */
export const PRODUCT_DELETE_STOREFRONT_WARNING = 'حُذف المنتج، لكن تعذّر تحديث المتجر فورًا، وقد يتأخر ظهور التغيير في المتجر.'

/** شكل نتيجة الحذف (نفس MutationResult، ورفض الغلاف بنفس شكل الفشل). */
export type ProductDeleteCallResult =
  | { ok: true; data: ProductDeleteResult; warning?: string }
  | { ok: false; code: MutationErrorCode; message: string }

/**
 * بعد نداء الحذف (في الـ Server Action): تحديث المتجر مرة واحدة بس لو الحذف نجح. فشل التحديث أو استثناء فيه = نفس النجاح
 * ومعاه التحذير. الحذف نفسه مابيتعادش هنا خالص.
 */
export async function finishProductDelete(result: ProductDeleteCallResult, refresh: () => Promise<boolean>): Promise<ProductDeleteCallResult> {
  if (!result.ok) return result
  let refreshed = false
  try {
    refreshed = await refresh()
  } catch {
    refreshed = false
  }
  return refreshed ? result : { ...result, warning: PRODUCT_DELETE_STOREFRONT_WARNING }
}

/** قرار الكارت بعد الرد: نجاح من غير تحذير = رجوع للقايمة فورًا · نجاح بتحذير = يفضل في الصفحة ويعرض التحذير · فشل = بانر الفشل. */
export type ProductDeleteOutcome =
  | { kind: 'deleted'; navigate: true; notice: null }
  | { kind: 'deleted'; navigate: false; notice: string }
  | { kind: 'failed'; code: MutationErrorCode; message: string }

export function productDeleteOutcome(result: ProductDeleteCallResult): ProductDeleteOutcome {
  if (!result.ok) return { kind: 'failed', code: result.code, message: result.message }
  if (result.warning === undefined) return { kind: 'deleted', navigate: true, notice: null }
  return { kind: 'deleted', navigate: false, notice: PRODUCT_DELETE_STOREFRONT_WARNING }
}

/** نداء الحذف من الكارت: مرة واحدة بالظبط ومن غير أي إعادة تلقائية. أي استثناء (الشبكة) = فشل عام. */
export async function performProductDelete(call: () => Promise<ProductDeleteCallResult>): Promise<ProductDeleteOutcome> {
  try {
    return productDeleteOutcome(await call())
  } catch {
    return { kind: 'failed', code: 'INTERNAL', message: PRODUCT_DELETE_MESSAGES.internal }
  }
}
