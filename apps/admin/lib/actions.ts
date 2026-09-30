'use server'

/**
 * قوالب Server Actions — **المرحلة ب**.
 *
 * كل دالة بترجّع DISABLED لأن ADMIN_MUTATIONS_ENABLED=false.
 * مفيش أي كتابة على قاعدة البيانات ولا على Storage من الملف ده.
 *
 * التوقيعات هي العقد النهائي. لما العلم يتفتح، جسم كل دالة بس هو
 * اللي يتغيّر.
 *
 * معرّفات الصور **نصوص** — أعمدة bigint في Postgres بتترجع strings.
 *
 * رفع الصور **مش** Server Action — بيمر على راوت multipart:
 *   POST /api/admin/products/:productId/images
 * والراوت ده لسه ما اتعملش عن قصد.
 */

import type {
  AdminImage,
  AdminProduct,
  ImageFit,
  OrderStatus,
  ShippingSettings,
  StoreContent,
  StoreIdentity,
} from './adminData'
import { guardMutations, type MutationResult } from './mutations'

function blocked<T>(): MutationResult<T> {
  const guard = guardMutations()
  if (guard) return guard
  // مسار غير مستخدم في المرحلة ب — التنفيذ الحقيقي بيجي بعد الموافقة
  return { ok: false, code: 'INTERNAL', message: 'التنفيذ لسه ما اتوصلش' }
}

// ── المنتجات ─────────────────────────────────────────────────
export async function saveProductAction(
  _input: Partial<AdminProduct> & { id?: number; expectedUpdatedAt?: string },
): Promise<MutationResult<AdminProduct>> {
  return blocked<AdminProduct>()
}

export async function setProductVisibilityAction(
  _id: number,
  _visible: boolean,
  _expectedUpdatedAt: string,
): Promise<MutationResult<AdminProduct>> {
  return blocked<AdminProduct>()
}

export async function reorderProductsAction(_orderedIds: number[]): Promise<MutationResult<null>> {
  return blocked<null>()
}

// ── الصور ────────────────────────────────────────────────────
/**
 * بعد نجاح العملية دي لازم الواجهة تعيد قراءة getProduct(id) —
 * تبديل الرئيسية بيغيّر أكتر من صورة (الجديدة تبقى cover والقديمة
 * ترجع contain)، فـ patch محلي لحقل واحد بيعرض حالة غلط.
 */
export async function setPrimaryImageAction(_productId: number, _imageId: string): Promise<MutationResult<null>> {
  return blocked<null>()
}

/** cover على الرئيسية قيمة افتراضية مش قاعدة — الأدمن يقدر يرجّعها contain. */
export async function setImageFitAction(_imageId: string, _fit: ImageFit): Promise<MutationResult<null>> {
  return blocked<null>()
}

export async function reorderImagesAction(_productId: number, _orderedIds: string[]): Promise<MutationResult<null>> {
  return blocked<null>()
}

export async function deleteImageAction(_imageId: string): Promise<MutationResult<null>> {
  return blocked<null>()
}

// ── الطلبات ──────────────────────────────────────────────────
export async function updateOrderStatusAction(_orderId: number, _status: OrderStatus): Promise<MutationResult<null>> {
  return blocked<null>()
}

export async function addOrderNoteAction(_orderId: number, _note: string): Promise<MutationResult<null>> {
  return blocked<null>()
}

export async function resendNotificationAction(_orderId: number): Promise<MutationResult<null>> {
  return blocked<null>()
}

// ── المحتوى والإعدادات ───────────────────────────────────────
/**
 * المحتوى بيتحفظ **كامل** مش patch، و expectedUpdatedAt **إلزامي**.
 * السبب: الستة مفاتيح بتتحفظ مع بعض، والحفظ الجزئي بيخلي التحقق من
 * التعارض بلا معنى.
 */
export async function saveContentAction(
  _input: StoreContent,
  _expectedUpdatedAt: string,
): Promise<MutationResult<StoreContent>> {
  return blocked<StoreContent>()
}

export async function saveShippingAction(_patch: Partial<ShippingSettings>): Promise<MutationResult<ShippingSettings>> {
  return blocked<ShippingSettings>()
}

export async function saveIdentityAction(_patch: Partial<StoreIdentity>): Promise<MutationResult<StoreIdentity>> {
  return blocked<StoreIdentity>()
}

/** telegramToken مدخل فقط — ما بيترجعش أبدًا. */
export async function saveOperationalSettingsAction(_patch: {
  notifyEmail?: string
  telegramToken?: string
}): Promise<MutationResult<null>> {
  return blocked<null>()
}

export async function revalidateStorefrontAction(): Promise<MutationResult<null>> {
  return blocked<null>()
}

/** placeholder لرفع الصور — الراوت الحقيقي ما اتعملش. */
export async function uploadProductImagePlaceholder(_productId: number): Promise<MutationResult<AdminImage>> {
  return blocked<AdminImage>()
}
