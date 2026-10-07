/**
 * أسماء أخطاء 0020 (المخزون والمشتريات) — قايمة واحدة مقفولة: 23 اسم، من 45200 لـ 45222.
 *
 * من غير server-only عن قصد: ملف خالص. بيستورده lib/data/client.ts (قايمة KNOWN_SENTINELS)،
 * وجدول الأخطاء، والاختبارات.
 *
 * ⚠️ المطابقة بتتم على حقل message في رد PostgREST (الاسم نفسه زي ما الدالة بترميه)،
 *    مش على SQLSTATE. الأكواد هنا توثيق، والاختبارات بتتأكد إنها متصلة وبنفس الترتيب.
 */

export const INVENTORY_SENTINELS = [
  'ZELL_INV_FORBIDDEN',
  'ZELL_INV_NOT_FOUND',
  'ZELL_INV_CONFLICT',
  'ZELL_INV_INVALID',
  'ZELL_INV_SUPPLIER_INACTIVE',
  'ZELL_INV_LOCATION_INACTIVE',
  'ZELL_INV_PRODUCT_UNIT',
  'ZELL_INV_WIDTH_NOT_ALLOWED',
  'ZELL_INV_NOT_DRAFT',
  'ZELL_INV_EMPTY',
  'ZELL_INV_ALLOCATION_BASE_ZERO',
  'ZELL_INV_DISCOUNT_TOO_LARGE',
  'ZELL_INV_COMMAND_MISMATCH',
  'ZELL_INV_HAS_DEPENDENCIES',
  'ZELL_INV_NOT_POSTED',
  'ZELL_INV_ZERO_COST_RULE',
  'ZELL_INV_IMMUTABLE',
  'ZELL_INV_SALE_UNIT_LOCKED',
  'ZELL_INV_SUPPLIER_NAME_TAKEN',
  'ZELL_INV_LOCATION_CODE_TAKEN',
  'ZELL_INV_MAIN_LOCKED',
  'ZELL_INV_DATE_IN_FUTURE',
  'ZELL_INV_COMMAND_RACE',
] as const

export type InventorySentinel = (typeof INVENTORY_SENTINELS)[number]

/** SQLSTATE لكل اسم (من 0020_inventory_purchasing.sql). */
export const INVENTORY_SQLSTATE: Readonly<Record<InventorySentinel, string>> = {
  ZELL_INV_FORBIDDEN: '45200',
  ZELL_INV_NOT_FOUND: '45201',
  ZELL_INV_CONFLICT: '45202',
  ZELL_INV_INVALID: '45203',
  ZELL_INV_SUPPLIER_INACTIVE: '45204',
  ZELL_INV_LOCATION_INACTIVE: '45205',
  ZELL_INV_PRODUCT_UNIT: '45206',
  ZELL_INV_WIDTH_NOT_ALLOWED: '45207',
  ZELL_INV_NOT_DRAFT: '45208',
  ZELL_INV_EMPTY: '45209',
  ZELL_INV_ALLOCATION_BASE_ZERO: '45210',
  ZELL_INV_DISCOUNT_TOO_LARGE: '45211',
  ZELL_INV_COMMAND_MISMATCH: '45212',
  ZELL_INV_HAS_DEPENDENCIES: '45213',
  ZELL_INV_NOT_POSTED: '45214',
  ZELL_INV_ZERO_COST_RULE: '45215',
  ZELL_INV_IMMUTABLE: '45216',
  ZELL_INV_SALE_UNIT_LOCKED: '45217',
  ZELL_INV_SUPPLIER_NAME_TAKEN: '45218',
  ZELL_INV_LOCATION_CODE_TAKEN: '45219',
  ZELL_INV_MAIN_LOCKED: '45220',
  ZELL_INV_DATE_IN_FUTURE: '45221',
  ZELL_INV_COMMAND_RACE: '45222',
}

export function isInventorySentinel(value: unknown): value is InventorySentinel {
  return typeof value === 'string' && (INVENTORY_SENTINELS as readonly string[]).includes(value)
}
