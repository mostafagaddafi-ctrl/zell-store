'use server'

/**
 * قوالب Server Actions — **المرحلة ب** + حارس المرحلة ج.
 *
 * كل دالة بتنادي requireAdminAction() **بنفسها** قبل أي حاجة تانية.
 * ده مقصود ومكرر: الـ layout مش حدود أمان، والـ Server Action نقطة
 * دخول مستقلة تمامًا عن أي صفحة.
 *
 * الترتيب في كل دالة:
 *   1. requireAdminAction  -> UNAUTHENTICATED | FORBIDDEN
 *   2. guardMutations      -> DISABLED
 *   3. التنفيذ             -> لسه ما اتعملش
 *
 * كل دالة لسه بترجّع DISABLED لأن ADMIN_MUTATIONS_ENABLED=false.
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
import { requireAdminAction } from './auth/guards'
import { guardMutations, type MutationResult } from './mutations'

/** بعد ما الصلاحية تعدّي: العلم، وبعدين لا تنفيذ. */
function notImplemented<T>(): MutationResult<T> {
  const guard = guardMutations()
  if (guard) return guard
  // مسار غير مستخدم في المرحلة ب — التنفيذ الحقيقي بيجي بعد الموافقة
  return { ok: false, code: 'INTERNAL', message: 'التنفيذ لسه ما اتوصلش' }
}

// ── المنتجات ─────────────────────────────────────────────────
export async function saveProductAction(
  _input: Partial<AdminProduct> & { id?: number; expectedUpdatedAt?: string },
): Promise<MutationResult<AdminProduct>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<AdminProduct>()
}

export async function setProductVisibilityAction(
  _id: number,
  _visible: boolean,
  _expectedUpdatedAt: string,
): Promise<MutationResult<AdminProduct>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<AdminProduct>()
}

export async function reorderProductsAction(_orderedIds: number[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

// ── الصور ────────────────────────────────────────────────────
/**
 * بعد نجاح العملية دي لازم الواجهة تعيد قراءة getProduct(id) —
 * تبديل الرئيسية بيغيّر أكتر من صورة (الجديدة تبقى cover والقديمة
 * ترجع contain)، فـ patch محلي لحقل واحد بيعرض حالة غلط.
 */
export async function setPrimaryImageAction(_productId: number, _imageId: string): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

/** cover على الرئيسية قيمة افتراضية مش قاعدة — الأدمن يقدر يرجّعها contain. */
export async function setImageFitAction(_imageId: string, _fit: ImageFit): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

export async function reorderImagesAction(_productId: number, _orderedIds: string[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

export async function deleteImageAction(_imageId: string): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

// ── الطلبات ──────────────────────────────────────────────────
export async function updateOrderStatusAction(_orderId: number, _status: OrderStatus): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

export async function addOrderNoteAction(_orderId: number, _note: string): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

export async function resendNotificationAction(_orderId: number): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
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
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<StoreContent>()
}

export async function saveShippingAction(_patch: Partial<ShippingSettings>): Promise<MutationResult<ShippingSettings>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<ShippingSettings>()
}

export async function saveIdentityAction(_patch: Partial<StoreIdentity>): Promise<MutationResult<StoreIdentity>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<StoreIdentity>()
}

/** telegramToken مدخل فقط — ما بيترجعش أبدًا. */
export async function saveOperationalSettingsAction(_patch: {
  notifyEmail?: string
  telegramToken?: string
}): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

export async function revalidateStorefrontAction(): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<null>()
}

/** placeholder لرفع الصور — الراوت الحقيقي ما اتعملش. */
export async function uploadProductImagePlaceholder(_productId: number): Promise<MutationResult<AdminImage>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return notImplemented<AdminImage>()
}
