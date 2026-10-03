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

import type { AdminCollection, AdminImage, AdminProduct, ImageFit, OrderStatus } from './adminData'
import { requireAdminAction } from './auth/guards'
import { guardMutations, type MutationResult } from './mutations'
import type { SaveVersion } from './mutations/concurrency'
import {
  createCollection,
  deleteCollection,
  reorderCollections,
  setCollectionProducts,
  setCollectionPlacement,
  addProductToCollection,
  updateCollection,
} from './mutations/collections'
import { removeCollectionCover } from './mutations/collectionCover'
import { setOfferEnabled } from './mutations/offer'
import { testTelegram } from './systemHealth'
import { saveInstallation, type InstallationSettings } from './mutations/installation'
import { saveShippingAreas } from './mutations/shippingAreas'
import { saveHomeProducts } from './mutations/homeProducts'
import type { HomeProducts } from '@zell/core'
import { saveSocialLinks, type SocialLinksInput } from './mutations/socialLinks'
import { saveContent } from './mutations/content'
import { setImageFit, setPrimaryImage } from './mutations/images'
import { saveInternalNote, updateOrderStatus } from './mutations/orders'
import { saveProduct, setProductVisibility } from './mutations/products'
import { reorderProductImages, reorderProducts } from './mutations/reorder'
import { saveIdentity, saveShipping } from './mutations/settings'
import { saveShippingOrder } from './mutations/shippingOrder'
import type { CollectionInput } from './validation/collection'
import type { ContentInput } from './validation/content'
import type { ProductInput } from './validation/product'
import type { IdentityInput, ShippingInput } from './validation/settings'
import { REVALIDATION_WARNING, revalidateStorefront } from './revalidateStorefront'

async function refreshAfter<T>(result: MutationResult<T>): Promise<MutationResult<T>> {
  if (!result.ok) return result
  const refreshed = await revalidateStorefront()
  return refreshed ? result : { ...result, warning: REVALIDATION_WARNING }
}

// ── المنتجات ─────────────────────────────────────────────────
/**
 * collectionId: إنشاء من جوه قسم. المنتج بيتضاف آخر القسم بعد ما يتعمل.
 * فشل الربط **مابيلغيش** المنتج — بيرجع نجاح بتحذير يقول يتربط إزاي.
 */
export async function saveProductAction(
  input: ProductInput,
  collectionId?: string,
): Promise<MutationResult<AdminProduct>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  // كل منتج جديد لازم يكون في قسم — القاعدة على السيرفر مش في الواجهة بس
  if (input.id === undefined && (collectionId === undefined || collectionId.trim() === '')) {
    return { ok: false, code: 'VALIDATION', message: 'اختار قسم للمنتج الأول — كل منتج لازم يكون في قسم.' }
  }
  const result = await saveProduct(input)
  if (!result.ok || input.id !== undefined || collectionId === undefined) return refreshAfter(result)
  const linked = await addProductToCollection(collectionId, result.data.id)
  const withLink = linked
    ? result
    : { ...result, warning: 'المنتج اتعمل، بس ماتضافش للقسم. ضيفه من صفحة القسم.' }
  return refreshAfter(withLink)
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
  return refreshAfter(await setProductVisibility(id, visible, expectedUpdatedAt))
}

/** لازم تشمل كل المنتجات — المخفية كمان — مرة واحدة بالظبط. */
export async function reorderProductsAction(orderedIds: number[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await reorderProducts(orderedIds))
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
  return refreshAfter(await setPrimaryImage(productId, imageId))
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
  return refreshAfter(await setImageFit(imageId, fit, expectedUpdatedAt))
}

/** صور المعرض بس، وبتتكتب من صفر. المعرّفات نصوص. */
export async function reorderImagesAction(productId: number, orderedIds: string[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await reorderProductImages(productId, orderedIds))
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
  return refreshAfter(await saveContent(input, expectedUpdatedAt))
}

/** حفظ كامل مش patch — الدالة بتكتب الأربعة مفاتيح مع بعض. */
/**
 * order: ترتيب المحافظات في صفحة الطلب (اختياري). بيتحفظ **بعد** الأسعار،
 * ومستقل عنها — لو فشل، الأسعار بتفضل محفوظة والرسالة بتقول كده بالظبط.
 */
export async function saveShippingAction(
  input: ShippingInput,
  expectedUpdatedAt: string,
  order?: string[],
  areas?: Record<string, string[]>,
): Promise<MutationResult<SaveVersion>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  const result = await saveShipping(input, expectedUpdatedAt)
  if (!result.ok) return refreshAfter(result)
  const known = Object.keys((input as { rates?: Record<string, unknown> }).rates ?? {})
  const problems: string[] = []
  if (order !== undefined) {
    const ordered = await saveShippingOrder(order, known)
    if (!ordered.ok) problems.push('ترتيب المحافظات')
  }
  if (areas !== undefined) {
    const saved = await saveShippingAreas(areas, known)
    if (!saved.ok) problems.push('المناطق (' + saved.message + ')')
  }
  if (problems.length > 0) {
    return refreshAfter({ ...result, warning: 'الأسعار اتحفظت، بس ' + problems.join(' و') + ' ما اتحفظش — دوس حفظ تاني.' })
  }
  return refreshAfter(result)
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
  return refreshAfter(await saveIdentity(input, expectedUpdatedAt))
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
// ── المجموعات ────────────────────────────────────────────────
export async function createCollectionAction(input: CollectionInput): Promise<MutationResult<AdminCollection>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await createCollection(input))
}

export async function updateCollectionAction(
  id: string,
  input: CollectionInput,
  expectedUpdatedAt: string,
): Promise<MutationResult<AdminCollection>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await updateCollection(id, input, expectedUpdatedAt))
}

export async function setCollectionPlacementAction(
  id: string,
  showOnHome: boolean,
  showInNav: boolean,
  expectedUpdatedAt: string,
): Promise<MutationResult<AdminCollection>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await setCollectionPlacement(id, showOnHome, showInNav, expectedUpdatedAt))
}

export async function removeCollectionCoverAction(id: string): Promise<MutationResult<AdminCollection>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await removeCollectionCover(id))
}

export async function deleteCollectionAction(
  id: string,
  expectedUpdatedAt: string,
): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await deleteCollection(id, expectedUpdatedAt))
}

export async function setCollectionProductsAction(
  id: string,
  productIds: number[],
): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await setCollectionProducts(id, productIds))
}

export async function reorderCollectionsAction(orderedIds: string[]): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await reorderCollections(orderedIds))
}

export async function revalidateStorefrontAction(): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return (await revalidateStorefront())
    ? { ok: true, data: null }
    : { ok: false, code: 'INTERNAL', message: 'تحديث المتجر الفوري فشل. قد يتأخر الظهور حتى ٥ دقائق.' }
}

/** placeholder لرفع الصور — الراوت الحقيقي ما اتعملش. */
export async function uploadProductImagePlaceholder(_productId: number): Promise<MutationResult<AdminImage>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return { ok: false, code: 'INTERNAL', message: 'رفع الصور لسه ما اتعملش.' }
}

/** «إظهار نص العرض» — بيتحفظ فورًا من صفحة الهوية. */
export async function setOfferEnabledAction(enabled: boolean): Promise<MutationResult<{ enabled: boolean }>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await setOfferEnabled(enabled))
}

/** رسالة تجربة حقيقية على تليجرام — فحص، مش تعديل، فمش محتاج علم التعديلات. */
export async function testTelegramAction(): Promise<MutationResult<{ delivered: true }>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  return testTelegram()
}

/** تحديث كاش المتجر فعلًا — نفس revalidateStorefront اللي بعد كل حفظ. */
export async function refreshStorefrontAction(): Promise<MutationResult<null>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const refreshed = await revalidateStorefront()
  return refreshed
    ? { ok: true, data: null }
    : { ok: false, code: 'INTERNAL', message: 'تحديث المتجر فشل — راجع «الاتصال بالمتجر» في حالة النظام فوق' }
}

/** فني التركيب — تشغيل وسطر توضيح ومحافظات. */
export async function saveInstallationAction(input: InstallationSettings): Promise<MutationResult<InstallationSettings>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await saveInstallation(input))
}

// ── الصفحة الرئيسية ──────────────────────────────────────────
/** منتجات الرئيسية (الكل · مختارة · ولا حاجة) + اسم رابط «كل المنتجات». */
export async function saveHomeProductsAction(input: HomeProducts): Promise<MutationResult<HomeProducts>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await saveHomeProducts(input))
}

// ── السوشيال ─────────────────────────────────────────────────
/** روابط السوشيال اللي بتظهر في فوتر المتجر. الفاضي = مخفي. */
export async function saveSocialLinksAction(input: SocialLinksInput): Promise<MutationResult<SocialLinksInput>> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const gate = guardMutations()
  if (gate) return gate
  return refreshAfter(await saveSocialLinks(input))
}
