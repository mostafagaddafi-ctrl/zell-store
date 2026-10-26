/**
 * PRODUCT-DELETE (المرحلة B) — حالات كارت حذف المنتج وربط 45507 (منطق خالص — pnpm --filter @zell/admin cases).
 */

import {
  HOME_PRODUCTS_MISSING_MESSAGE,
  HOME_PRODUCTS_MISSING_SENTINEL,
  PRODUCT_DELETE_BLOCKERS,
  PRODUCT_DELETE_MESSAGES,
  homeProductsSaveMessage,
  parseProductDeletePreview,
  parseProductDeleteResult,
  productDeleteAllowed,
  productDeleteBlockers,
  productDeleteErrorCode,
  productDeleteFailure,
  productDeleteInputIssue,
  productDeleteQuestion,
  productDeleteSummary,
  type ProductDeletePreview,
} from './deleteProduct'

export type ProductDeleteCaseFailure = { name: string; expected: string; actual: string }

const failures: ProductDeleteCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const AT = '2026-10-27T10:00:00.123456+00:00'
const RAW = {
  product_id: 12, is_active: false, updated_at: AT, has_orders: false, has_stock: false, orphan_conflict: false,
  images: 3, widths: 2, addons: 1, used_as_addon_in: 0, collections: 1, in_home: true, can_delete: true,
}
const CLEAN: ProductDeletePreview = {
  productId: 12, isActive: false, updatedAt: AT, hasOrders: false, hasStock: false, orphanConflict: false,
  images: 3, widths: 2, addons: 1, usedAsAddonIn: 0, collections: 1, inHome: true, canDelete: true,
}
const pre = (patch: Partial<ProductDeletePreview>): ProductDeletePreview => ({ ...CLEAN, ...patch })

export function runProductDeleteCases(): { passed: number; failures: ProductDeleteCaseFailure[] } {
  // المعاينة
  check('D01 parse the preview reply', parseProductDeletePreview(RAW), CLEAN)
  check('D02 bad preview shapes = null', [
    parseProductDeletePreview(null),
    parseProductDeletePreview([RAW]),
    parseProductDeletePreview({ ...RAW, images: -1 }),
    parseProductDeletePreview({ ...RAW, widths: 1.5 }),
    parseProductDeletePreview({ ...RAW, has_stock: 'no' }),
    parseProductDeletePreview({ ...RAW, updated_at: '' }),
    parseProductDeletePreview({ ...RAW, product_id: 0 }),
    parseProductDeletePreview({ ...RAW, can_delete: undefined }),
  ], [null, null, null, null, null, null, null, null])

  // أسباب المنع والزرار
  check('D10 hidden clean product: no blockers, button allowed', [productDeleteBlockers(CLEAN), productDeleteAllowed(CLEAN)], [[], true])
  check('D11 each blocker alone, in order', [
    productDeleteBlockers(pre({ isActive: true, canDelete: false })),
    productDeleteBlockers(pre({ hasOrders: true, canDelete: false })),
    productDeleteBlockers(pre({ hasStock: true, canDelete: false })),
    productDeleteBlockers(pre({ orphanConflict: true, canDelete: false })),
  ], [[PRODUCT_DELETE_BLOCKERS.visible], [PRODUCT_DELETE_BLOCKERS.orders], [PRODUCT_DELETE_BLOCKERS.stock], [PRODUCT_DELETE_BLOCKERS.orphanConflict]])
  check('D12 several blockers together (visible first)', productDeleteBlockers(pre({ isActive: true, hasOrders: true, hasStock: true, canDelete: false })),
    [PRODUCT_DELETE_BLOCKERS.visible, PRODUCT_DELETE_BLOCKERS.orders, PRODUCT_DELETE_BLOCKERS.stock])
  check('D13 the database and the panel must agree: can_delete false alone, or a blocker with can_delete true = no button', [
    productDeleteAllowed(pre({ canDelete: false })),
    productDeleteAllowed(pre({ hasOrders: true, canDelete: true })),
  ], [false, false])

  // الأعداد والتأكيد
  check('D20 summary lines (no «used as addon» line when 0)', productDeleteSummary(CLEAN),
    ['الصور: 3', 'العروض: 2', 'الأقسام: 1', 'الإضافات المرتبطة به: 1', 'موجود في الصفحة الرئيسية'])
  check('D21 summary with «used as addon» and not in home', productDeleteSummary(pre({ usedAsAddonIn: 4, inHome: false })),
    ['الصور: 3', 'العروض: 2', 'الأقسام: 1', 'الإضافات المرتبطة به: 1', 'مستخدم كإضافة في 4 منتج'])
  check('D22 confirm question has the name and the counts', productDeleteQuestion('  فيلم عازل  ', pre({ images: 0, inHome: false })),
    'سيُحذف «فيلم عازل» نهائيًا مع: الصور: 0، العروض: 2، الأقسام: 1، الإضافات المرتبطة به: 1. هل تريد المتابعة؟')

  // نتيجة الحذف
  const OK = { deleted: true, product_id: 12, images_registered: 2, images_already_pending: 1, removed_from_home: true, addon_links: 2, collection_links: 1 }
  check('D30 parse the delete reply', parseProductDeleteResult(OK, 12),
    { productId: 12, imagesRegistered: 2, imagesAlreadyPending: 1, removedFromHome: true, addonLinks: 2, collectionLinks: 1 })
  check('D31 bad delete replies = null (other product, not deleted, bad count, missing flag)', [
    parseProductDeleteResult(OK, 13),
    parseProductDeleteResult({ ...OK, deleted: false }, 12),
    parseProductDeleteResult({ ...OK, addon_links: -1 }, 12),
    parseProductDeleteResult({ ...OK, removed_from_home: null }, 12),
    parseProductDeleteResult(null, 12),
  ], [null, null, null, null, null])

  // الأخطاء: كل كود من 0022 + الهوية
  const err = (code: string) => ({ code, message: 'x', details: null, hint: null })
  check('D40 every 0022 / identity code maps to a clear result', [
    productDeleteFailure(err('45400'), 400), productDeleteFailure(err('45401'), 400), productDeleteFailure(err('45402'), 400),
    productDeleteFailure(err('45501'), 400), productDeleteFailure(err('45502'), 400), productDeleteFailure(err('45503'), 400),
    productDeleteFailure(err('45504'), 400), productDeleteFailure(err('45505'), 400), productDeleteFailure(err('45506'), 400),
    productDeleteFailure(err('45508'), 400),
  ], [
    { code: 'UNAUTHENTICATED', message: PRODUCT_DELETE_MESSAGES.unauthenticated },
    { code: 'FORBIDDEN', message: PRODUCT_DELETE_MESSAGES.forbidden },
    { code: 'FORBIDDEN', message: PRODUCT_DELETE_MESSAGES.forbidden },
    { code: 'NOT_FOUND', message: PRODUCT_DELETE_MESSAGES.notFound },
    { code: 'CONFLICT', message: PRODUCT_DELETE_MESSAGES.conflict },
    { code: 'VALIDATION', message: PRODUCT_DELETE_BLOCKERS.visible },
    { code: 'VALIDATION', message: PRODUCT_DELETE_BLOCKERS.orders },
    { code: 'VALIDATION', message: PRODUCT_DELETE_BLOCKERS.stock },
    { code: 'VALIDATION', message: PRODUCT_DELETE_BLOCKERS.orphanConflict },
    { code: 'VALIDATION', message: PRODUCT_DELETE_MESSAGES.busy },
  ])
  check('D41 code by name in message (no code field), and prefix NAME:', [
    productDeleteErrorCode({ message: 'ZELL_PRODUCT_BUSY' }),
    productDeleteErrorCode({ message: 'ZELL_PRODUCT_HAS_STOCK: detail' }),
    productDeleteErrorCode({ message: 'something ZELL_PRODUCT_BUSY' }),
  ], ['45508', '45505', null])
  check('D42 unknown / missing function (before SQL apply) / network = INTERNAL with no details; HTTP 401 = session', [
    productDeleteFailure({ code: 'PGRST202', message: 'Could not find the function' }, 404),
    productDeleteFailure(err('45507'), 400),
    productDeleteFailure(null, 0),
    productDeleteFailure({ code: '42501', message: 'permission denied' }, 403),
    productDeleteFailure({ message: 'JWT expired' }, 401),
  ], [
    { code: 'INTERNAL', message: PRODUCT_DELETE_MESSAGES.internal },
    { code: 'INTERNAL', message: PRODUCT_DELETE_MESSAGES.internal },
    { code: 'INTERNAL', message: PRODUCT_DELETE_MESSAGES.internal },
    { code: 'INTERNAL', message: PRODUCT_DELETE_MESSAGES.internal },
    { code: 'UNAUTHENTICATED', message: PRODUCT_DELETE_MESSAGES.unauthenticated },
  ])

  // المدخلات
  check('D50 input checks before any call', [
    productDeleteInputIssue(12, AT),
    productDeleteInputIssue(0, AT),
    productDeleteInputIssue(1.5, AT),
    productDeleteInputIssue('12', AT),
    productDeleteInputIssue(12, ''),
    productDeleteInputIssue(12, 'yesterday'),
    productDeleteInputIssue(12, null),
  ], [null, PRODUCT_DELETE_MESSAGES.invalid, PRODUCT_DELETE_MESSAGES.invalid, PRODUCT_DELETE_MESSAGES.invalid,
      PRODUCT_DELETE_MESSAGES.invalid, PRODUCT_DELETE_MESSAGES.invalid, PRODUCT_DELETE_MESSAGES.invalid])

  // ربط 45507 في حفظ الرئيسية
  check('D60 home save: ZELL_HOME_PRODUCTS_MISSING = clear validation message; anything else = current behaviour (null)', [
    homeProductsSaveMessage(HOME_PRODUCTS_MISSING_SENTINEL),
    homeProductsSaveMessage(null),
    homeProductsSaveMessage('ZELL_INVALID_ORDER'),
  ], [HOME_PRODUCTS_MISSING_MESSAGE, null, null])

  return { passed, failures }
}
