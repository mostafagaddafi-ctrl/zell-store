'use server'

/**
 * Server Actions للوحة — **المرحلة د١**.
 *
 * كل action متصدّرة من غلاف actionWithAccess (0021-P ب2) بصلاحية مكتوبة نصًا، والغلاف بيتحقق
 * **بنفسه** قبل أي حاجة تانية. ده مقصود: الـ layout مش حدود أمان، والـ Server Action نقطة
 * دخول مستقلة تمامًا عن أي صفحة. الجدول (manifest): lib/access/manifest.ts.
 *
 * الترتيب في كل دالة (جوه الغلاف ثم الدالة):
 *   ١. الهوية ثم الصلاحية -> UNAUTHENTICATED | FORBIDDEN (نفس رسايل requireAdminAction)
 *   ٢. علم التعديلات (mutates: true) -> DISABLED (نتيجة guardMutations() نفسها)
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
import { actionWithAccess } from './access/instance'
import type { AccessContext } from './access/wrappers'
import type { MutationResult } from './mutations'
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
import {
  installerAreasMissingFromShipping,
  saveInstallation,
  type InstallationInput,
  type OrphanArea,
} from './mutations/installation'
import type { InstallationRecord } from './data/installation'
import { saveInstallationToolsPage } from './mutations/installationToolsPage'
import type { ToolsPageRecord } from './data/installationToolsPage'
import { saveShippingAreas } from './mutations/shippingAreas'
import { saveHomeProducts } from './mutations/homeProducts'
import type { HomeProducts, InstallationToolsPage } from '@zell/core'
import { saveSocialLinks } from './mutations/socialLinks'
import type { SocialLinksInput } from './data/socialLinks'
import { saveProductWidths } from './mutations/productWidths'
import type { AdminWidth } from './data/productWidths'
import { saveProductAddons } from './mutations/productAddons'
import { saveAddonsTitle } from './mutations/addonsTitle'
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
export const saveProductAction = actionWithAccess(
  'zell.products.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    input: ProductInput,
    collectionId?: string,
  ): Promise<MutationResult<AdminProduct>> => {
    // كل منتج جديد لازم يكون في قسم — القاعدة على السيرفر مش في الواجهة بس
    // 0016 — منتج القطعة (إضافة) مش لازم يكون في قسم
    if (input.id === undefined && input.saleUnit !== 'piece' && (collectionId === undefined || collectionId.trim() === '')) {
      return { ok: false, code: 'VALIDATION', message: 'اختار قسم للمنتج الأول — كل منتج لازم يكون في قسم.' }
    }
    const result = await saveProduct(input)
    if (!result.ok || input.id !== undefined || collectionId === undefined) return refreshAfter(result)
    const linked = await addProductToCollection(collectionId, result.data.id)
    const withLink = linked
      ? result
      : { ...result, warning: 'المنتج اتعمل، بس ماتضافش للقسم. ضيفه من صفحة القسم.' }
    return refreshAfter(withLink)
  },
)

export const setProductVisibilityAction = actionWithAccess(
  'zell.products.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    id: number,
    visible: boolean,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<AdminProduct>> => {
    return refreshAfter(await setProductVisibility(id, visible, expectedUpdatedAt))
  },
)

/** لازم تشمل كل المنتجات — المخفية كمان — مرة واحدة بالظبط. */
export const reorderProductsAction = actionWithAccess(
  'zell.products.edit',
  { mutates: true },
  async (_ctx: AccessContext, orderedIds: number[]): Promise<MutationResult<null>> => {
    return refreshAfter(await reorderProducts(orderedIds))
  },
)

// ── الصور ────────────────────────────────────────────────────
/**
 * بعد نجاح العملية دي لازم الواجهة تعيد قراءة getProduct(id) —
 * تبديل الرئيسية بيغيّر أكتر من صورة (الجديدة تبقى cover والقديمة
 * ترجع contain)، فـ patch محلي لحقل واحد بيعرض حالة غلط.
 */
export const setPrimaryImageAction = actionWithAccess(
  'zell.products.images_edit',
  { mutates: true },
  async (_ctx: AccessContext, productId: number, imageId: string): Promise<MutationResult<null>> => {
    return refreshAfter(await setPrimaryImage(productId, imageId))
  },
)

/** cover على الرئيسية قيمة افتراضية مش قاعدة — الأدمن يقدر يرجّعها contain. */
export const setImageFitAction = actionWithAccess(
  'zell.products.images_edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    imageId: string,
    fit: ImageFit,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<null>> => {
    return refreshAfter(await setImageFit(imageId, fit, expectedUpdatedAt))
  },
)

/** صور المعرض بس، وبتتكتب من صفر. المعرّفات نصوص. */
export const reorderImagesAction = actionWithAccess(
  'zell.products.images_edit',
  { mutates: true },
  async (_ctx: AccessContext, productId: number, orderedIds: string[]): Promise<MutationResult<null>> => {
    return refreshAfter(await reorderProductImages(productId, orderedIds))
  },
)

/** برّه نطاق المرحلة — محتاجة تنظيف Storage مع الصف في معاملة واحدة. */
export const deleteImageAction = actionWithAccess(
  'zell.unimplemented',
  { mutates: true },
  async (_ctx: AccessContext, _imageId: string): Promise<MutationResult<null>> => {
    return { ok: false, code: 'INTERNAL', message: 'حذف الصور لسه ما اتعملش.' }
  },
)

// ── الطلبات ──────────────────────────────────────────────────
export const updateOrderStatusAction = actionWithAccess(
  'zell.orders.status_edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    orderId: number,
    status: OrderStatus,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<null>> => {
    return updateOrderStatus(orderId, status, expectedUpdatedAt)
  },
)

export const addOrderNoteAction = actionWithAccess(
  'zell.orders.note_edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    orderId: number,
    note: string,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<null>> => {
    return saveInternalNote(orderId, note, expectedUpdatedAt)
  },
)

/** برّه نطاق المرحلة. */
export const resendNotificationAction = actionWithAccess(
  'zell.unimplemented',
  { mutates: true },
  async (_ctx: AccessContext, _orderId: number): Promise<MutationResult<null>> => {
    return { ok: false, code: 'INTERNAL', message: 'إعادة إرسال الإشعار لسه ما اتعملتش.' }
  },
)

// ── المحتوى والإعدادات ───────────────────────────────────────
/**
 * الستة مفاتيح بتتحفظ مع بعض في معاملة واحدة.
 * بترجّع الطابع الجديد — الواجهة تستخدمه كرمز تعارض للحفظة الجاية،
 * ولازم تعيد قراءة المحتوى كامل لو هتعرضه.
 */
export const saveContentAction = actionWithAccess(
  'zell.content.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    input: ContentInput,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<SaveVersion>> => {
    return refreshAfter(await saveContent(input, expectedUpdatedAt))
  },
)

/** حفظ كامل مش patch — الدالة بتكتب الأربعة مفاتيح مع بعض. */
/**
 * order: ترتيب المحافظات في صفحة الطلب (اختياري). بيتحفظ **بعد** الأسعار،
 * ومستقل عنها — لو فشل، الأسعار بتفضل محفوظة والرسالة بتقول كده بالظبط.
 */
export const saveShippingAction = actionWithAccess(
  'zell.shipping.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    input: ShippingInput,
    expectedUpdatedAt: string,
    order?: string[],
    areas?: Record<string, string[]>,
  ): Promise<MutationResult<SaveVersion>> => {
    const result = await saveShipping(input, expectedUpdatedAt)
    if (!result.ok) return refreshAfter(result)
    const known = Object.keys((input as { rates?: Record<string, unknown> }).rates ?? {})
    const problems: string[] = []
    if (order !== undefined) {
      const ordered = await saveShippingOrder(order, known)
      if (!ordered.ok) problems.push('ترتيب المحافظات')
    }
    const notices: string[] = []
    if (areas !== undefined) {
      const saved = await saveShippingAreas(areas, known)
      if (!saved.ok) problems.push('المناطق (' + saved.message + ')')
      else {
        // منطقة متاحة لفني التركيب اتشالت أو اتغير اسمها → الفني مش متاح فيها
        const lost = await installerAreasMissingFromShipping().catch((): OrphanArea[] => [])
        if (lost.length > 0) {
          notices.push(
            'مناطق متاحة لفني التركيب مابقتش في الشحن: ' +
              lost.map((item) => item.area + ' (' + item.governorate + ')').join('، ') +
              ' — الفني مش متاح فيها لحد ما تفعّل الاسم الجديد من صفحة فني التركيب.',
          )
        }
      }
    }
    if (problems.length > 0) {
      notices.unshift('الأسعار اتحفظت، بس ' + problems.join(' و') + ' ما اتحفظش — دوس حفظ تاني.')
    }
    if (notices.length > 0) return refreshAfter({ ...result, warning: notices.join(' ') })
    return refreshAfter(result)
  },
)

/**
 * حفظ كامل للأربعة مفاتيح. **اللوجو مش فيهم** — الدالة مابتلمسش
 * logo_url، وطابع النسخة محسوب على الأربعة دول بس.
 */
export const saveIdentityAction = actionWithAccess(
  'zell.identity.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    input: IdentityInput,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<SaveVersion>> => {
    return refreshAfter(await saveIdentity(input, expectedUpdatedAt))
  },
)

/** telegramToken مدخل فقط — ما بيترجعش أبدًا. برّه نطاق المرحلة. */
export const saveOperationalSettingsAction = actionWithAccess(
  'zell.unimplemented',
  { mutates: true },
  async (_ctx: AccessContext, _patch: {
    notifyEmail?: string
    telegramToken?: string
  }): Promise<MutationResult<null>> => {
    return { ok: false, code: 'INTERNAL', message: 'حفظ إعدادات التشغيل لسه ما اتعملش.' }
  },
)

/** برّه نطاق المرحلة. */
// ── المجموعات ────────────────────────────────────────────────
export const createCollectionAction = actionWithAccess(
  'zell.collections.edit',
  { mutates: true },
  async (_ctx: AccessContext, input: CollectionInput): Promise<MutationResult<AdminCollection>> => {
    return refreshAfter(await createCollection(input))
  },
)

export const updateCollectionAction = actionWithAccess(
  'zell.collections.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    id: string,
    input: CollectionInput,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<AdminCollection>> => {
    return refreshAfter(await updateCollection(id, input, expectedUpdatedAt))
  },
)

export const setCollectionPlacementAction = actionWithAccess(
  'zell.collections.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    id: string,
    showOnHome: boolean,
    showInNav: boolean,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<AdminCollection>> => {
    return refreshAfter(await setCollectionPlacement(id, showOnHome, showInNav, expectedUpdatedAt))
  },
)

export const removeCollectionCoverAction = actionWithAccess(
  'zell.collections.edit',
  { mutates: true },
  async (_ctx: AccessContext, id: string): Promise<MutationResult<AdminCollection>> => {
    return refreshAfter(await removeCollectionCover(id))
  },
)

export const deleteCollectionAction = actionWithAccess(
  'zell.collections.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    id: string,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<null>> => {
    return refreshAfter(await deleteCollection(id, expectedUpdatedAt))
  },
)

export const setCollectionProductsAction = actionWithAccess(
  'zell.collections.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    id: string,
    productIds: number[],
  ): Promise<MutationResult<null>> => {
    return refreshAfter(await setCollectionProducts(id, productIds))
  },
)

export const reorderCollectionsAction = actionWithAccess(
  'zell.collections.edit',
  { mutates: true },
  async (_ctx: AccessContext, orderedIds: string[]): Promise<MutationResult<null>> => {
    return refreshAfter(await reorderCollections(orderedIds))
  },
)

export const revalidateStorefrontAction = actionWithAccess(
  'zell.storefront.revalidate',
  { mutates: true },
  async (_ctx: AccessContext): Promise<MutationResult<null>> => {
    return (await revalidateStorefront())
      ? { ok: true, data: null }
      : { ok: false, code: 'INTERNAL', message: 'تحديث المتجر الفوري فشل. قد يتأخر الظهور حتى ٥ دقائق.' }
  },
)

/** placeholder لرفع الصور — الراوت الحقيقي ما اتعملش. */
export const uploadProductImagePlaceholder = actionWithAccess(
  'zell.unimplemented',
  { mutates: true },
  async (_ctx: AccessContext, _productId: number): Promise<MutationResult<AdminImage>> => {
    return { ok: false, code: 'INTERNAL', message: 'رفع الصور لسه ما اتعملش.' }
  },
)

/** «إظهار نص العرض» — بيتحفظ فورًا من صفحة الهوية. */
export const setOfferEnabledAction = actionWithAccess(
  'zell.identity.edit',
  { mutates: true },
  async (_ctx: AccessContext, enabled: boolean): Promise<MutationResult<{ enabled: boolean }>> => {
    return refreshAfter(await setOfferEnabled(enabled))
  },
)

/** رسالة تجربة حقيقية على تليجرام — فحص، مش تعديل، فمش محتاج علم التعديلات. */
export const testTelegramAction = actionWithAccess(
  'zell.telegram.test',
  { mutates: false },
  async (_ctx: AccessContext): Promise<MutationResult<{ delivered: true }>> => {
    return testTelegram()
  },
)

/** تحديث كاش المتجر فعلًا — نفس revalidateStorefront اللي بعد كل حفظ. */
export const refreshStorefrontAction = actionWithAccess(
  'zell.storefront.revalidate',
  { mutates: false },
  async (_ctx: AccessContext): Promise<MutationResult<null>> => {
    const refreshed = await revalidateStorefront()
    return refreshed
      ? { ok: true, data: null }
      : { ok: false, code: 'INTERNAL', message: 'تحديث المتجر فشل — راجع «الاتصال بالمتجر» في حالة النظام فوق' }
  },
)

/**
 * فني التركيب — التشغيل وسعر المتر والمناطق وانتقالها (settings.installation).
 * expectedUpdatedAt: طابع الصف اللي اللوحة شافته، أو null لو مكانش موجود.
 */
export const saveInstallationAction = actionWithAccess(
  'zell.installation.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    input: InstallationInput,
    expectedUpdatedAt: string | null,
  ): Promise<MutationResult<InstallationRecord>> => {
    return refreshAfter(await saveInstallation(input, expectedUpdatedAt))
  },
)

// ── الصفحة الرئيسية ──────────────────────────────────────────
/** منتجات الرئيسية (الكل · مختارة · ولا حاجة) + اسم رابط «كل المنتجات». */
export const saveHomeProductsAction = actionWithAccess(
  'zell.collections.edit',
  { mutates: true },
  async (_ctx: AccessContext, input: HomeProducts): Promise<MutationResult<HomeProducts>> => {
    return refreshAfter(await saveHomeProducts(input))
  },
)

// ── السوشيال ─────────────────────────────────────────────────
/** روابط السوشيال اللي بتظهر في فوتر المتجر. الفاضي = مخفي. */
export const saveSocialLinksAction = actionWithAccess(
  'zell.identity.edit',
  { mutates: true },
  async (_ctx: AccessContext, input: SocialLinksInput): Promise<MutationResult<SocialLinksInput>> => {
    return refreshAfter(await saveSocialLinks(input))
  },
)

// ── عروض الرول (0015) ────────────────────────────────────────
/** استبدال كل العروض الإضافية لمنتج — ذرّي عن طريق zell_set_product_widths. */
export const saveProductWidthsAction = actionWithAccess(
  'zell.products.edit',
  { mutates: true },
  async (_ctx: AccessContext, productId: number, rows: AdminWidth[]): Promise<MutationResult<AdminWidth[]>> => {
    return refreshAfter(await saveProductWidths(productId, rows))
  },
)

// ── الإضافات (0016) ──────────────────────────────────────────
/** إضافات فيلم (منتجات قطعة) بالترتيب — ذرّي عن طريق zell_set_product_addons. */
export const saveProductAddonsAction = actionWithAccess(
  'zell.products.edit',
  { mutates: true },
  async (_ctx: AccessContext, productId: number, addonIds: number[]): Promise<MutationResult<number[]>> => {
    return refreshAfter(await saveProductAddons(productId, addonIds))
  },
)

/** عنوان جزء الإضافات في صفحة المنتج — واحد لكل المنتجات. */
export const saveAddonsTitleAction = actionWithAccess(
  'zell.products.edit',
  { mutates: true },
  async (_ctx: AccessContext, title: string): Promise<MutationResult<string>> => {
    return refreshAfter(await saveAddonsTitle(title))
  },
)

// ── صفحة «أدوات التركيب» ─────────────────────────────────────
/** المحتوى بس (صف settings واحد بـ updated_at). الربط من صفحة الفيلم. */
export const saveInstallationToolsPageAction = actionWithAccess(
  'zell.installation_tools.edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    input: InstallationToolsPage,
    expectedUpdatedAt: string | null,
  ): Promise<MutationResult<ToolsPageRecord>> => {
    return refreshAfter(await saveInstallationToolsPage(input, expectedUpdatedAt))
  },
)
