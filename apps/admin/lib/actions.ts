'use server'

/**
 * Server Actions للوحة — **المرحلة د١**.
 *
 * كل دالة بتنادي requireAdminAction() **بنفسها** قبل أي حاجة تانية.
 * ده مقصود ومكرر: الـ layout مش حدود أمان، والـ Server Action نقطة
 * دخول مستقلة تمامًا عن أي صفحة.
 *
 * الترتيب في كل دالة:
 *   ١. requireAdminAction  -> UNAUTHENTICATED | FORBIDDEN
 *   ٢. guardMutations      -> DISABLED
 *   ٣. تحقق المدخلات        -> VALIDATION
 *   ٤. تزامن تفاؤلي         -> CONFLICT | NOT_FOUND
 *   ٥. الكتابة
 *
 * الصلاحية **قبل** علم التعديلات. العكس كان بيقول لمجهول إن
 * "التعديلات موقوفة" — تسريب معلومة عن حالة النظام.
 *
 * ADMIN_MUTATIONS_ENABLED لسه false، فكل اللي تحت بيرجع DISABLED
 * في التشغيل. الكود موجود للمراجعة مش للتنفيذ.
 *
 * الخمس عمليات اللي كانت مستنية ذرّية بقت متوصّلة بدوال الداتابيز:
 *   zell_save_content · zell_save_shipping · zell_save_identity
 *   zell_reorder_products · zell_reorder_product_images
 * الفحص والكتابة جواها في نفس المعاملة، فمفيش نافذة سباق.
 *
 * معرّفات الصور **نصوص** — أعمدة bigint بتترجع strings.
 *
 * رفع الصور مش Server Action — بيمر على راوت multipart لسه ما اتعملش.
 */

import type { AdminImage, AdminProduct, ImageFit, OrderStatus } from './adminData'
import { requireAdminAction } from './auth/guards'
import { guardMutations, type MutationResult } from './mutations'
import type { SaveVersion } from './mutations/concurrency'
import { saveContent } from './mutations/content'
import { setImageFit, setPrimaryImage } from './mutations/images'
import { saveInternalNote, updateOrderStatus } from './mutations/orders'
import { saveProduct, setProductVisibility } from './mutations/products'
import { reorderProductImages, reorderProducts } from './mutations/reorder'
import { saveIdentity, saveShipping } from './mutations/settings'
import type { ContentInput } from './validation/content'
import type { ProductInput } from './validation/product'
import type { IdentityInput, ShippingInput } from './validation/settings'

// ── المنتجات ─────────────────────────────────────────────────
export async function saveProductAction(input: ProductInput): Promise<MutationResult<AdminProduct>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return saveProduct(input)
}

export async function setProductVisibilityAction(
  id: number,
  visible: boolean,
  expectedUpdatedAt: string,
): Promise<MutationResult<AdminProduct>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return setProductVisibility(id, visible, expectedUpdatedAt)
}

/** لازم تشمل كل المنتجات — المخفية كمان — مرة واحدة بالظبط. */
export async function reorderProductsAction(orderedIds: number[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return reorderProducts(orderedIds)
}

// ── الصور ────────────────────────────────────────────────────
/**
 * بعد نجاح العملية دي لازم الواجهة تعيد قراءة getProduct(id) —
 * تبديل الرئيسية بيغيّر أكتر من صورة (الجديدة تبقى cover والقديمة
 * ترجع contain)، فـ patch محلي لحقل واحد بيعرض حالة غلط.
 */
export async function setPrimaryImageAction(productId: number, imageId: string): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return setPrimaryImage(productId, imageId)
}

/** cover على الرئيسية قيمة افتراضية مش قاعدة — الأدمن يقدر يرجّعها contain. */
export async function setImageFitAction(
  imageId: string,
  fit: ImageFit,
  expectedUpdatedAt: string,
): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return setImageFit(imageId, fit, expectedUpdatedAt)
}

/** صور المعرض بس، وبتتكتب من صفر. المعرّفات نصوص. */
export async function reorderImagesAction(productId: number, orderedIds: string[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return reorderProductImages(productId, orderedIds)
}

/** برّه نطاق المرحلة — محتاجة تنظيف Storage مع الصف في معاملة واحدة. */
export async function deleteImageAction(_imageId: string): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return { ok: false, code: 'INTERNAL', message: 'حذف الصور لسه ما اتعملش.' }
}

// ── الطلبات ──────────────────────────────────────────────────
export async function updateOrderStatusAction(
  orderId: number,
  status: OrderStatus,
  expectedUpdatedAt: string,
): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return updateOrderStatus(orderId, status, expectedUpdatedAt)
}

export async function addOrderNoteAction(
  orderId: number,
  note: string,
  expectedUpdatedAt: string,
): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return saveInternalNote(orderId, note, expectedUpdatedAt)
}

/** برّه نطاق المرحلة. */
export async function resendNotificationAction(_orderId: number): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return { ok: false, code: 'INTERNAL', message: 'إعادة إرسال الإشعار لسه ما اتعملتش.' }
}

// ── المحتوى والإعدادات ───────────────────────────────────────
/**
 * الستة مفاتيح بتتحفظ مع بعض في معاملة واحدة.
 * بترجّع الطابع الجديد — الواجهة تستخدمه كرمز تعارض للحفظة الجاية،
 * ولازم تعيد قراءة المحتوى كامل لو هتعرضه.
 */
export async function saveContentAction(
  input: ContentInput,
  expectedUpdatedAt: string,
): Promise<MutationResult<SaveVersion>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return saveContent(input, expectedUpdatedAt)
}

/** حفظ كامل مش patch — الدالة بتكتب الأربعة مفاتيح مع بعض. */
export async function saveShippingAction(
  input: ShippingInput,
  expectedUpdatedAt: string,
): Promise<MutationResult<SaveVersion>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return saveShipping(input, expectedUpdatedAt)
}

/**
 * حفظ كامل للأربعة مفاتيح. **اللوجو مش فيهم** — الدالة مابتلمسش
 * logo_url، وطابع النسخة محسوب على الأربعة دول بس.
 */
export async function saveIdentityAction(
  input: IdentityInput,
  expectedUpdatedAt: string,
): Promise<MutationResult<SaveVersion>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return saveIdentity(input, expectedUpdatedAt)
}

/** telegramToken مدخل فقط — ما بيترجعش أبدًا. برّه نطاق المرحلة. */
export async function saveOperationalSettingsAction(_patch: {
  notifyEmail?: string
  telegramToken?: string
}): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return { ok: false, code: 'INTERNAL', message: 'حفظ إعدادات التشغيل لسه ما اتعملش.' }
}

/** برّه نطاق المرحلة. */
export async function revalidateStorefrontAction(): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return { ok: false, code: 'INTERNAL', message: 'تحديث كاش المتجر لسه ما اتعملش.' }
}

/** placeholder لرفع الصور — الراوت الحقيقي ما اتعملش. */
export async function uploadProductImagePlaceholder(_productId: number): Promise<MutationResult<AdminImage>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return { ok: false, code: 'INTERNAL', message: 'رفع الصور لسه ما اتعملش.' }
}
