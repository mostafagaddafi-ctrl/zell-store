/**
 * 0021-P — قايمة الصلاحيات (٢٩) وفئة كل واحدة، بالحرف زي catalog الداتابيز:
 *   backend/db/migrations/0021p_erp_access.sql (erp.access.*) + 0021p_zell_erp_access.sql (zell.*).
 * CI بيقارن القايمة دي بالـ SQL (scripts/check-capabilities.mjs) وأي اختلاف = فشل.
 *
 * منطق صافي من غير I/O — بيتشغّل في حالات اللوحة (lib/access/access.cases.ts).
 * العقد: docs/contracts/0021-P.md §٦ و docs/contracts/0021-P-code.md.
 */

export const ZELL_CAPABILITIES = [
  'zell.dashboard.view',
  'zell.orders.view',
  'zell.orders.status_edit',
  'zell.orders.note_edit',
  'zell.products.view',
  'zell.products.edit',
  'zell.products.images_edit',
  'zell.collections.view',
  'zell.collections.edit',
  'zell.content.view',
  'zell.content.edit',
  'zell.identity.view',
  'zell.identity.edit',
  'zell.shipping.view',
  'zell.shipping.edit',
  'zell.installation.view',
  'zell.installation.edit',
  'zell.installation_tools.view',
  'zell.installation_tools.edit',
  'zell.settings.view',
  'zell.telegram.test',
  'zell.storefront.revalidate',
  'zell.coupons.view',
  'zell.coupons.edit',
  'zell.inventory0020.view',
  'zell.inventory0020.edit',
  'zell.unimplemented',
  'erp.access.view',
  'erp.access.manage',
] as const

export type Capability = (typeof ZELL_CAPABILITIES)[number]

export type CapabilityCategory = 'operational' | 'sales' | 'owner'

export const CAPABILITY_CATEGORY: Readonly<Record<Capability, CapabilityCategory>> = {
  'zell.dashboard.view': 'sales',
  'zell.orders.view': 'sales',
  'zell.orders.status_edit': 'sales',
  'zell.orders.note_edit': 'sales',
  'zell.products.view': 'sales',
  'zell.products.edit': 'sales',
  'zell.products.images_edit': 'operational',
  'zell.collections.view': 'operational',
  'zell.collections.edit': 'operational',
  'zell.content.view': 'operational',
  'zell.content.edit': 'operational',
  'zell.identity.view': 'operational',
  'zell.identity.edit': 'operational',
  'zell.shipping.view': 'sales',
  'zell.shipping.edit': 'sales',
  'zell.installation.view': 'sales',
  'zell.installation.edit': 'sales',
  'zell.installation_tools.view': 'operational',
  'zell.installation_tools.edit': 'operational',
  'zell.settings.view': 'operational',
  'zell.telegram.test': 'operational',
  'zell.storefront.revalidate': 'operational',
  'zell.coupons.view': 'owner',
  'zell.coupons.edit': 'owner',
  'zell.inventory0020.view': 'owner',
  'zell.inventory0020.edit': 'owner',
  'zell.unimplemented': 'owner',
  'erp.access.view': 'owner',
  'erp.access.manage': 'owner',
}

/** صلاحية «أكشنز لسه مش متعملة». الأدمن عليها بياخد رسالة واضحة بدل رسالة FORBIDDEN العامة. */
export const UNIMPLEMENTED_CAPABILITY: Capability = 'zell.unimplemented'

export function isCapability(value: string): value is Capability {
  return (ZELL_CAPABILITIES as readonly string[]).includes(value)
}

/**
 * قرار وضع legacy لأدمن شغال: مسموح لو الفئة operational أو sales، وممنوع لو owner.
 * ده بالظبط سلوك النهارده (ownerGate على الكوبونات والمخزون بس، وهما فئة owner).
 */
export function legacyAdminAllows(capability: Capability): boolean {
  return CAPABILITY_CATEGORY[capability] !== 'owner'
}
