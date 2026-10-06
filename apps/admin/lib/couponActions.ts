'use server'

/**
 * أكواد الخصم (0019 · PR5) — Server Actions للمالك بس.
 *
 * الترتيب في كل دالة:
 *   ١. requireAdminAction  -> UNAUTHENTICATED | FORBIDDEN
 *   ٢. ownerGate           -> FORBIDDEN للـadmin (حتى لو نادى الـaction مباشرة من غير الواجهة)
 *   ٣. guardMutations      -> DISABLED
 *   ٤. التحقق والتزامن والكتابة (lib/mutations/coupons)
 *
 * 🔒 مفيش action للحذف — الكوبون بيتوقف بس.
 * 🔒 الكوبونات نفسها مش في كاش المتجر (المعاينة والطلب بيقروا الداتابيز لحظيًا)، فالـrevalidate
 *    بعد تغيير المفتاح بس — هو اللي بيظهر/يخفي الخانة.
 */

import { requireAdminAction } from './auth/guards'
import { ownerGate, type AdminCoupon, type CouponInput } from './coupons/form'
import { guardMutations, type MutationResult } from './mutations'
import { createCoupon, setCouponActive, setCouponsEnabled, updateCoupon } from './mutations/coupons'
import { REVALIDATION_WARNING, revalidateStorefront } from './revalidateStorefront'

async function ownerOnly(): Promise<MutationResult<never> | null> {
  const auth = await requireAdminAction()
  if (!auth.ok) return auth
  const owner = ownerGate(auth.identity.role)
  if (owner !== null) return owner
  return guardMutations()
}

export async function createCouponAction(input: CouponInput): Promise<MutationResult<AdminCoupon>> {
  const blocked = await ownerOnly()
  if (blocked) return blocked
  return createCoupon(input)
}

export async function updateCouponAction(
  id: string,
  input: CouponInput,
  expectedUpdatedAt: string,
): Promise<MutationResult<AdminCoupon>> {
  const blocked = await ownerOnly()
  if (blocked) return blocked
  return updateCoupon(id, input, expectedUpdatedAt)
}

export async function setCouponActiveAction(
  id: string,
  active: boolean,
  expectedUpdatedAt: string,
): Promise<MutationResult<AdminCoupon>> {
  const blocked = await ownerOnly()
  if (blocked) return blocked
  return setCouponActive(id, active, expectedUpdatedAt)
}

export async function setCouponsEnabledAction(enabled: boolean): Promise<MutationResult<{ enabled: boolean }>> {
  const blocked = await ownerOnly()
  if (blocked) return blocked
  const result = await setCouponsEnabled(enabled)
  if (!result.ok) return result
  const refreshed = await revalidateStorefront()
  return refreshed ? result : { ...result, warning: REVALIDATION_WARNING }
}
