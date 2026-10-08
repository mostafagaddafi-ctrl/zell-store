'use server'

/**
 * أكواد الخصم (0019 · PR5) — Server Actions للمالك بس.
 *
 * الترتيب في كل دالة (غلاف actionWithAccess — 0021-P ب2):
 *   ١. الهوية                -> UNAUTHENTICATED | FORBIDDEN
 *   ٢. الصلاحية 'zell.coupons.edit' (فئة owner) -> FORBIDDEN برسالة OWNER_ONLY_MESSAGE للـadmin
 *      (حتى لو نادى الـaction مباشرة من غير الواجهة)
 *   ٣. علم التعديلات (mutates: true) -> DISABLED
 *   ٤. التحقق والتزامن والكتابة (lib/mutations/coupons)
 *
 * 🔒 مفيش action للحذف — الكوبون بيتوقف بس.
 * 🔒 الكوبونات نفسها مش في كاش المتجر (المعاينة والطلب بيقروا الداتابيز لحظيًا)، فالـrevalidate
 *    بعد تغيير المفتاح بس — هو اللي بيظهر/يخفي الخانة.
 */

import { actionWithAccess } from './access/instance'
import type { AccessContext } from './access/wrappers'
import { OWNER_ONLY_MESSAGE, type AdminCoupon, type CouponInput } from './coupons/form'
import type { MutationResult } from './mutations'
import { createCoupon, setCouponActive, setCouponsEnabled, updateCoupon } from './mutations/coupons'
import { REVALIDATION_WARNING, revalidateStorefront } from './revalidateStorefront'

export const createCouponAction = actionWithAccess(
  'zell.coupons.edit',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (_ctx: AccessContext, input: CouponInput): Promise<MutationResult<AdminCoupon>> => {
    return createCoupon(input)
  },
)

export const updateCouponAction = actionWithAccess(
  'zell.coupons.edit',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (
    _ctx: AccessContext,
    id: string,
    input: CouponInput,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<AdminCoupon>> => {
    return updateCoupon(id, input, expectedUpdatedAt)
  },
)

export const setCouponActiveAction = actionWithAccess(
  'zell.coupons.edit',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (
    _ctx: AccessContext,
    id: string,
    active: boolean,
    expectedUpdatedAt: string,
  ): Promise<MutationResult<AdminCoupon>> => {
    return setCouponActive(id, active, expectedUpdatedAt)
  },
)

export const setCouponsEnabledAction = actionWithAccess(
  'zell.coupons.edit',
  { mutates: true, forbiddenMessage: OWNER_ONLY_MESSAGE },
  async (_ctx: AccessContext, enabled: boolean): Promise<MutationResult<{ enabled: boolean }>> => {
    const result = await setCouponsEnabled(enabled)
    if (!result.ok) return result
    const refreshed = await revalidateStorefront()
    return refreshed ? result : { ...result, warning: REVALIDATION_WARNING }
  },
)
