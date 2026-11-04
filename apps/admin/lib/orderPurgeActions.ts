'use server'

/**
 * ORDER-DELETE (المرحلة C) — Server Actions شاشة حذف الطلبات (العقد docs/contracts/ORDER-DELETE.md §٥).
 *
 * الغلاف actionWithAccess بصلاحية فئة المالك zell.orders.payments_admin (نفس حذف المنتج وإعدادات المالك، من غير صلاحية جديدة
 * في 0021-P)، ورسالة رفض خاصة ORDER_PURGE_OWNER_ONLY_MESSAGE. القرار النهائي في الداتابيز (المالك بس)، فأي أدمن معاه الصلاحية
 * برضه بيترفض. المعاينة قراية (mutates: false)، والحذف كتابة (mutates: true، علم التعديلات).
 */

import { actionWithAccess } from './access/instance'
import type { AccessContext } from './access/wrappers'
import { readOrderPurgePreview } from './data/orderPurge'
import type { MutationResult } from './mutations'
import { purgeOrders } from './mutations/orderPurge'
import { ORDER_PURGE_OWNER_ONLY_MESSAGE, type PurgePreview, type PurgeRequest, type PurgeResult } from './orders/purge'

export const previewOrderPurgeAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: false, forbiddenMessage: ORDER_PURGE_OWNER_ONLY_MESSAGE },
  async (_ctx: AccessContext, ids: number[] | null): Promise<MutationResult<PurgePreview>> => readOrderPurgePreview(ids),
)

export const purgeOrdersAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: true, forbiddenMessage: ORDER_PURGE_OWNER_ONLY_MESSAGE },
  async (ctx: AccessContext, request: PurgeRequest): Promise<MutationResult<PurgeResult>> =>
    purgeOrders({ userId: ctx.identity.userId, email: ctx.identity.email }, request),
)
