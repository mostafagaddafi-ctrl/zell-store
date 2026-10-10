'use server'

/**
 * 0021-A P2 — Server Actions الدفعات ورسوم التأكيد (العقد 0021-A §٣ و§٥).
 *
 * كل action من غلاف actionWithAccess (0021-P ب2) بصلاحية مكتوبة نصًا:
 *   تسجيل دفعة · التسليم مع التحصيل ← zell.orders.payments_record (فئة sales: الأدمن والمالك)
 *   التسليم الآجل الصريح (من غير تحصيل) ← zell.orders.status_edit
 *   الرد · طرق الدفع · إعدادات الدفع ← zell.orders.payments_admin (فئة owner) برسالة OWNER_ONLY_MESSAGE
 * الترتيب: الهوية والصلاحية ← علم التعديلات (mutates: true) ← التحقق ← نداء zell_payment_* بجلسة المستخدم.
 */

import { actionWithAccess } from './access/instance'
import type { AccessContext } from './access/wrappers'
import { OWNER_ONLY_MESSAGE } from './coupons/form'
import type { MutationResult } from './mutations'
import {
  addPaymentMethod,
  deletePaymentMethod,
  deliverOrder,
  savePaymentSettings,
  updatePaymentMethod,
  writePayment,
  type DeliverInput,
  type PaymentInput,
  type SettingsInput,
} from './mutations/payments'

export const recordPaymentAction = actionWithAccess(
  'zell.orders.payments_record',
  { mutates: true },
  async (_ctx: AccessContext, input: PaymentInput): Promise<MutationResult<null>> => writePayment('payment', input),
)

export const deliverWithCollectionAction = actionWithAccess(
  'zell.orders.payments_record',
  { mutates: true },
  async (_ctx: AccessContext, input: DeliverInput): Promise<MutationResult<null>> => deliverOrder(input),
)

export const deliverOnCreditAction = actionWithAccess(
  'zell.orders.status_edit',
  { mutates: true },
  async (_ctx: AccessContext, input: DeliverInput): Promise<MutationResult<null>> =>
    deliverOrder({ ...input, amountPiastres: null, onCredit: true }),
)

export const refundPaymentAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (_ctx: AccessContext, input: PaymentInput): Promise<MutationResult<null>> => writePayment('refund', input),
)

export const addPaymentMethodAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (_ctx: AccessContext, name: string): Promise<MutationResult<null>> => addPaymentMethod(name),
)

export const updatePaymentMethodAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (
    _ctx: AccessContext,
    id: number,
    expectedUpdatedAt: string,
    name: string,
    sortOrder: number,
    isArchived: boolean,
  ): Promise<MutationResult<null>> => updatePaymentMethod(id, expectedUpdatedAt, name, sortOrder, isArchived),
)

export const deletePaymentMethodAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (_ctx: AccessContext, id: number, expectedUpdatedAt: string): Promise<MutationResult<null>> => deletePaymentMethod(id, expectedUpdatedAt),
)

export const savePaymentSettingsAction = actionWithAccess(
  'zell.orders.payments_admin',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (_ctx: AccessContext, input: SettingsInput): Promise<MutationResult<null>> => savePaymentSettings(input),
)
