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
 * ⚠️ خمس عمليات **مش متعملة عن قصد** لأنها محتاجة ذرّية ماينفعش
 * تتحقق بـ PostgREST لوحده. تفاصيلها تحت.
 *
 * معرّفات الصور **نصوص** — أعمدة bigint بتترجع strings.
 *
 * رفع الصور مش Server Action — بيمر على راوت multipart لسه ما اتعملش.
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
import { setImageFit, setPrimaryImage } from './mutations/images'
import { saveInternalNote, updateOrderStatus } from './mutations/orders'
import { saveProduct, setProductVisibility } from './mutations/products'
import type { ProductInput } from './validation/product'

/**
 * العمليات اللي مستنية RPC ذرّية.
 *
 * السبب: التزامن التفاؤلي بـ GET-ثم-UPSERT **مش ذرّي** — في نافذة بين
 * الفحص والكتابة يقدر حد تاني يكتب فيها وتعديله يتمسح. وترتيب المنتجات
 * أو الصور بعدة PATCH متتالية بيسيب ترتيب نصّه متكتب لو فشل في النص.
 *
 * التنفيذ هيتم لما الدوال دي تتجهّز في Supabase:
 *   zell_save_content · zell_save_shipping · zell_save_identity
 *   zell_reorder_products · zell_reorder_product_images
 *
 * ⚠️ ممنوع تقليدها في TypeScript.
 */
function awaitingAtomicRpc<T>(): MutationResult<T> {
  return { ok: false, code: 'INTERNAL', message: 'العملية دي مستنية دالة داتابيز ذرّية. لسه ما اتفعّلتش.' }
}

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

/** مستنية zell_reorder_products — ترتيب جزئي ممنوع. */
export async function reorderProductsAction(_orderedIds: number[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return awaitingAtomicRpc<null>()
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

/** مستنية zell_reorder_product_images — ترتيب جزئي ممنوع. */
export async function reorderImagesAction(_productId: number, _orderedIds: string[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return awaitingAtomicRpc<null>()
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
/** مستنية zell_save_content — الستة مفاتيح لازم تتحفظ بفحص نسخة ذرّي. */
export async function saveContentAction(
  _input: StoreContent,
  _expectedUpdatedAt: string,
): Promise<MutationResult<StoreContent>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return awaitingAtomicRpc<StoreContent>()
}

/** مستنية zell_save_shipping. */
export async function saveShippingAction(_patch: Partial<ShippingSettings>): Promise<MutationResult<ShippingSettings>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return awaitingAtomicRpc<ShippingSettings>()
}

/** مستنية zell_save_identity. اللوجو برّه نطاق المرحلة دي. */
export async function saveIdentityAction(_patch: Partial<StoreIdentity>): Promise<MutationResult<StoreIdentity>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return awaitingAtomicRpc<StoreIdentity>()
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
