/**
 * 0021-P (ب2) — جدول الربط (manifest): كل رمز محمي في اللوحة ← الصلاحية · mutates · الحارس والعلم النهارده (قبل ب2).
 *
 *   todayGuard: admin = requireAdminPage / requireAdminAction بس · owner = ومعاه ownerGate أو role !== 'owner' (redirect /403)
 *   todayFlag : الرمز كان بيفحص guardMutations() قبل ب2
 *   forbiddenMessage / mapFailure: اسم الثابت / الدالة اللي الغلاف بياخدها في الكود (رسايل «للمالك بس» وشكل InventoryFailure)
 *
 * بيتفحص في CI مرتين: scripts/check-access-manifest.mjs (الجدول = الكود) و manifest.cases.ts (تكافؤ legacy).
 * العقد: docs/contracts/0021-P-code.md §٧.
 */
import type { Capability } from './capabilities'

export type ManifestKind = 'page' | 'layout' | 'route' | 'action'

export type ManifestEntry = {
  kind: ManifestKind
  /** المسار من جذر اللوحة (apps/admin). */
  file: string
  /** 'default' للصفحة والـ layout، اسم الـ method للراوت، اسم الدالة للـ action. */
  symbol: string
  capability: Capability | null
  mutates: boolean
  todayGuard: 'admin' | 'owner'
  todayFlag: boolean
  forbiddenMessage: 'OWNER_ONLY_MESSAGE' | 'INVENTORY_OWNER_ONLY_MESSAGE' | null
  mapFailure: 'rejectedFailure' | null
}

export const ACCESS_MANIFEST: readonly ManifestEntry[] = [
  { kind: 'layout', file: 'app/(dashboard)/layout.tsx', symbol: 'default', capability: null, mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/collections/[id]/page.tsx', symbol: 'default', capability: 'zell.collections.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/collections/new/page.tsx', symbol: 'default', capability: 'zell.collections.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/collections/page.tsx', symbol: 'default', capability: 'zell.collections.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/content/page.tsx', symbol: 'default', capability: 'zell.content.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/coupons/page.tsx', symbol: 'default', capability: 'zell.coupons.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/identity/page.tsx', symbol: 'default', capability: 'zell.identity.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/installation-tools/page.tsx', symbol: 'default', capability: 'zell.installation_tools.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/installation/page.tsx', symbol: 'default', capability: 'zell.installation.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/inventory/lots/page.tsx', symbol: 'default', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/inventory/openings/[id]/page.tsx', symbol: 'default', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/inventory/openings/new/page.tsx', symbol: 'default', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/inventory/openings/page.tsx', symbol: 'default', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/inventory/purchases/[id]/page.tsx', symbol: 'default', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/inventory/purchases/new/page.tsx', symbol: 'default', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/inventory/purchases/page.tsx', symbol: 'default', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/inventory/suppliers/page.tsx', symbol: 'default', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/orders/[orderNumber]/page.tsx', symbol: 'default', capability: 'zell.orders.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/orders/page.tsx', symbol: 'default', capability: 'zell.orders.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/page.tsx', symbol: 'default', capability: 'zell.dashboard.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/payments/page.tsx', symbol: 'default', capability: 'zell.orders.payments_admin', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/products/[id]/page.tsx', symbol: 'default', capability: 'zell.products.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/products/new/page.tsx', symbol: 'default', capability: 'zell.products.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/products/page.tsx', symbol: 'default', capability: 'zell.products.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/settings/page.tsx', symbol: 'default', capability: 'zell.settings.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'page', file: 'app/(dashboard)/shipping/page.tsx', symbol: 'default', capability: 'zell.shipping.view', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'route', file: 'app/api/admin/collections/[id]/cover/route.ts', symbol: 'POST', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'route', file: 'app/api/admin/products/[productId]/images/route.ts', symbol: 'POST', capability: 'zell.products.images_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'route', file: 'app/api/admin/site-images/route.ts', symbol: 'POST', capability: 'zell.identity.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveProductAction', capability: 'zell.products.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'setProductVisibilityAction', capability: 'zell.products.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'reorderProductsAction', capability: 'zell.products.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'setPrimaryImageAction', capability: 'zell.products.images_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'setImageFitAction', capability: 'zell.products.images_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'reorderImagesAction', capability: 'zell.products.images_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'deleteImageAction', capability: 'zell.unimplemented', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'updateOrderStatusAction', capability: 'zell.orders.status_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'addOrderNoteAction', capability: 'zell.orders.note_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'resendNotificationAction', capability: 'zell.unimplemented', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  // 0021-A A2 — دورة الطلب (actions جديدة، الحارس admin والعلم زي باقي كتابات الطلب)
  { kind: 'action', file: 'lib/orderActions.ts', symbol: 'recordOrderCallAction', capability: 'zell.orders.status_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/orderActions.ts', symbol: 'setOrderFollowUpAction', capability: 'zell.orders.status_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/orderActions.ts', symbol: 'setOrderDeliveryAction', capability: 'zell.orders.status_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/orderActions.ts', symbol: 'editOrderDetailsAction', capability: 'zell.orders.note_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/paymentActions.ts', symbol: 'recordPaymentAction', capability: 'zell.orders.payments_record', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/paymentActions.ts', symbol: 'deliverWithCollectionAction', capability: 'zell.orders.payments_record', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/paymentActions.ts', symbol: 'deliverOnCreditAction', capability: 'zell.orders.status_edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/paymentActions.ts', symbol: 'refundPaymentAction', capability: 'zell.orders.payments_admin', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/paymentActions.ts', symbol: 'addPaymentMethodAction', capability: 'zell.orders.payments_admin', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/paymentActions.ts', symbol: 'updatePaymentMethodAction', capability: 'zell.orders.payments_admin', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/paymentActions.ts', symbol: 'deletePaymentMethodAction', capability: 'zell.orders.payments_admin', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/paymentActions.ts', symbol: 'savePaymentSettingsAction', capability: 'zell.orders.payments_admin', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveContentAction', capability: 'zell.content.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveShippingAction', capability: 'zell.shipping.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveIdentityAction', capability: 'zell.identity.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveOperationalSettingsAction', capability: 'zell.unimplemented', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'createCollectionAction', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'updateCollectionAction', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'setCollectionPlacementAction', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'removeCollectionCoverAction', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'deleteCollectionAction', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'setCollectionProductsAction', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'reorderCollectionsAction', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'revalidateStorefrontAction', capability: 'zell.storefront.revalidate', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'uploadProductImagePlaceholder', capability: 'zell.unimplemented', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'setOfferEnabledAction', capability: 'zell.identity.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'testTelegramAction', capability: 'zell.telegram.test', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'refreshStorefrontAction', capability: 'zell.storefront.revalidate', mutates: false, todayGuard: 'admin', todayFlag: false, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveInstallationAction', capability: 'zell.installation.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveHomeProductsAction', capability: 'zell.collections.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveSocialLinksAction', capability: 'zell.identity.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveProductWidthsAction', capability: 'zell.products.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveProductAddonsAction', capability: 'zell.products.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveAddonsTitleAction', capability: 'zell.products.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/actions.ts', symbol: 'saveInstallationToolsPageAction', capability: 'zell.installation_tools.edit', mutates: true, todayGuard: 'admin', todayFlag: true, forbiddenMessage: null, mapFailure: null },
  { kind: 'action', file: 'lib/couponActions.ts', symbol: 'createCouponAction', capability: 'zell.coupons.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/couponActions.ts', symbol: 'updateCouponAction', capability: 'zell.coupons.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/couponActions.ts', symbol: 'setCouponActiveAction', capability: 'zell.coupons.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/couponActions.ts', symbol: 'setCouponsEnabledAction', capability: 'zell.coupons.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'OWNER_ONLY_MESSAGE', mapFailure: null },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'createSupplierAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'updateSupplierAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'previewPurchaseAction', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'createPurchaseAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'updatePurchaseAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'postPurchaseAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'discardPurchaseAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'voidPurchaseAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'previewOpeningAction', capability: 'zell.inventory0020.view', mutates: false, todayGuard: 'owner', todayFlag: false, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'createOpeningAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'updateOpeningAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'postOpeningAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'discardOpeningAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
  { kind: 'action', file: 'lib/inventoryActions.ts', symbol: 'voidOpeningAction', capability: 'zell.inventory0020.edit', mutates: true, todayGuard: 'owner', todayFlag: true, forbiddenMessage: 'INVENTORY_OWNER_ONLY_MESSAGE', mapFailure: 'rejectedFailure' },
]
