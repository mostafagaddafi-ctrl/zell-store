'use server'

/**
 * قوالب Server Actions — **المرحلة ب**.
 *
 * كل دالة هنا بترجّع حالة «موقوف» لأن ADMIN_MUTATIONS_ENABLED=false.
 * مفيش أي كتابة على قاعدة البيانات ولا على Storage من الملف ده.
 *
 * التوقيعات هي العقد النهائي: كل حفظ بياخد expectedUpdatedAt، والراجع
 * دايمًا MutationResult. لما العلم يتفتح، جسم كل دالة بس هو اللي يتغيّر.
 *
 * رفع الصور **مش** Server Action — بيمر على راوت multipart:
 *   POST /api/admin/products/:productId/images
 * والراوت ده لسه ما اتعملش عن قصد.
 */

import type { AdminImage, AdminProduct, ImageFit, OrderStatus, ShippingSettings, StoreContent, StoreIdentity } from './adminData'
import { guardMutations, type MutationResult } from './mutations'

function disabled<T>(): MutationResult<T> {
  const blocked = guardMutations()
  if (blocked) return blocked
  // مسار غير مستخدم في المرحلة ب — التنفيذ الحقيقي بيجي في المرحلة الجاية
  return { ok: false, code: 'INTERNAL', message: 'التنفيذ لسه ما اتوصلش' }
}

// ── المنتجات ─────────────────────────────────────────────────
export async function saveProductAction(
  _input: Partial<AdminProduct> & { id?: number; expectedUpdatedAt?: string },
): Promise<MutationResult<AdminProduct>> {
  return disabled<AdminProduct>()
}

export async function setProductVisibilityAction(
  _id: number,
  _visible: boolean,
  _expectedUpdatedAt: string,
): Promise<MutationResult<AdminProduct>> {
  return disabled<AdminProduct>()
}

export async function reorderProductsAction(_orderedIds: number[]): Promise<MutationResult<null>> {
  return disabled<null>()
}

// ── الصور ────────────────────────────────────────────────────
/**
 * بعد نجاح العملية دي لازم الواجهة تعيد قراءة getProduct(id) —
 * تبديل الرئيسية بيغيّر أكتر من صورة (الجديدة تبقى cover والقديمة
 * ترجع contain)، فـ patch محلي لحقل واحد بيعرض حالة غلط.
 */
export async function setPrimaryImageAction(_productId: number, _imageId: number): Promise<MutationResult<null>> {
  return disabled<null>()
}

/** cover على الرئيسية قيمة افتراضية مش قاعدة — الأدمن يقدر يرجّعها contain. */
export async function setImageFitAction(_imageId: number, _fit: ImageFit): Promise<MutationResult<null>> {
  return disabled<null>()
}

export async function reorderImagesAction(_productId: number, _orderedIds: number[]): Promise<MutationResult<null>> {
  return disabled<null>()
}

export async function deleteImageAction(_imageId: number): Promise<MutationResult<null>> {
  return disabled<null>()
}

// ── الطلبات ──────────────────────────────────────────────────
export async function updateOrderStatusAction(_orderId: number, _status: OrderStatus): Promise<MutationResult<null>> {
  return disabled<null>()
}

export async function addOrderNoteAction(_orderId: number, _note: string): Promise<MutationResult<null>> {
  return disabled<null>()
}

export async function resendNotificationAction(_orderId: number): Promise<MutationResult<null>> {
  return disabled<null>()
}

// ── المحتوى والإعدادات ───────────────────────────────────────
export async function saveContentAction(
  _patch: Partial<StoreContent>,
  _expectedUpdatedAt?: string,
): Promise<MutationResult<StoreContent>> {
  return disabled<StoreContent>()
}

export async function saveShippingAction(_patch: Partial<ShippingSettings>): Promise<MutationResult<ShippingSettings>> {
  return disabled<ShippingSettings>()
}

export async function saveIdentityAction(_patch: Partial<StoreIdentity>): Promise<MutationResult<StoreIdentity>> {
  return disabled<StoreIdentity>()
}

/** telegramToken مدخل فقط — ما بيترجعش أبدًا. */
export async function saveOperationalSettingsAction(_patch: {
  notifyEmail?: string
  telegramToken?: string
}): Promise<MutationResult<null>> {
  return disabled<null>()
}

export async function revalidateStorefrontAction(): Promise<MutationResult<null>> {
  return disabled<null>()
}

/** placeholder لرفع الصور — الراوت الحقيقي ما اتعملش. */
export async function uploadProductImagePlaceholder(_productId: number): Promise<MutationResult<AdminImage>> {
  return disabled<AdminImage>()
}
