'use server'

/**
 * 0021-A A2 — Server Actions دورة الطلب (المكالمة · المتابعة · الموعد المؤكد · تعديل بيانات الزبون).
 *
 * كل action من غلاف actionWithAccess (0021-P ب2) بصلاحية مكتوبة نصًا (العقد 0021-A §٥):
 *   الانتقال والمكالمة والمتابعة والموعد المؤكد ← zell.orders.status_edit · تعديل البيانات والملاحظة ← zell.orders.note_edit
 * الترتيب: الهوية والصلاحية ← علم التعديلات (mutates: true) ← التحقق ← نداء zell_order_* بجلسة المستخدم.
 * الممثل = sub من JWT الجلسة جوه الداتابيز؛ مفيش أي معامل ممثل. تغيير الحالة والملاحظة الداخلية في lib/actions.ts.
 */

import { actionWithAccess } from './access/instance'
import type { AccessContext } from './access/wrappers'
import type { MutationResult } from './mutations'
import { editOrderDetails, recordOrderCall, setOrderDelivery, setOrderFollowUp } from './mutations/orders'
import type { CallOutcome, DeliveryValue, DetailsChanges } from './orders/cycle'

export const recordOrderCallAction = actionWithAccess(
  'zell.orders.status_edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    orderId: number,
    outcome: CallOutcome,
    note: string,
    followUpAt: string | null,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<null>> => recordOrderCall(orderId, outcome, note, followUpAt, expectedUpdatedAt),
)

export const setOrderFollowUpAction = actionWithAccess(
  'zell.orders.status_edit',
  { mutates: true },
  async (
    _ctx: AccessContext,
    orderId: number,
    followUpAt: string | null,
    note: string,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<null>> => setOrderFollowUp(orderId, followUpAt, note, expectedUpdatedAt),
)

export const setOrderDeliveryAction = actionWithAccess(
  'zell.orders.status_edit',
  { mutates: true },
  async (_ctx: AccessContext, orderId: number, value: DeliveryValue, expectedUpdatedAt: string): Promise<MutationResult<null>> =>
    setOrderDelivery(orderId, value, expectedUpdatedAt),
)

export const editOrderDetailsAction = actionWithAccess(
  'zell.orders.note_edit',
  { mutates: true },
  async (_ctx: AccessContext, orderId: number, changes: DetailsChanges, expectedUpdatedAt: string): Promise<MutationResult<null>> =>
    editOrderDetails(orderId, changes, expectedUpdatedAt),
)
