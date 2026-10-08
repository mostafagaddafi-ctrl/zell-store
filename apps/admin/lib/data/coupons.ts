import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/coupons.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { restGet } from './client'
import { isCouponLive, toAdminCoupon, type CouponRow } from '../coupons/form'
import type { CouponsPage, CouponsSwitch } from '../mutations/coupons'

export const TABLE = 'coupons'

export const COLUMNS =
  'id,code,kind,percent_off,amount_off_piastres,max_discount_piastres,min_subtotal_piastres,' +
  'starts_at,ends_at,max_uses,max_uses_per_phone,is_active,internal_note,created_at,updated_at'

/**
 * العدّادين في نفس الطلب (مفيش N+1) — نفس العلاقة باسمين، والفلتر على الاسم الأول بس:
 *   uses = غير الملغية (العرض) · references = كل الأوردرات حتى الملغية (قفل الكود والنوع في النموذج)
 */
export const USES = 'uses:orders(count),references:orders(count)&uses.status=neq.cancelled'

export const COUPONS_PAGE_SIZE = 20

export const SWITCH_KEY = 'coupons_enabled'

/** سقف قراءة الكوبونات الفعّالة لفحص التشغيل — الجدول صغير، والفحص على ده بس. */
const LIVE_SCAN_LIMIT = 1000

export async function listCoupons(rawPage: number): Promise<CouponsPage> {
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1
  const offset = (page - 1) * COUPONS_PAGE_SIZE
  const result = await restGet<CouponRow>(
    TABLE,
    [
      'select=' + COLUMNS + ',' + USES,
      'order=created_at.desc,id.desc',
      'limit=' + String(COUPONS_PAGE_SIZE),
      'offset=' + String(offset),
    ].join('&'),
    { exactCount: true },
  )
  return { rows: result.rows.map(toAdminCoupon), total: result.total ?? result.rows.length, page, pageSize: COUPONS_PAGE_SIZE }
}

/** حالة المفتاح — jsonb true بالظبط = شغّال (نفس فحص الداتابيز والمتجر). */
export async function readCouponsSwitch(): Promise<CouponsSwitch> {
  const result = await restGet<{ value: unknown; updated_at: string | null }>(
    'settings',
    'select=value,updated_at&key=eq.' + SWITCH_KEY + '&limit=1',
  )
  const row = result.rows[0]
  return { enabled: row?.value === true, updatedAt: row?.updated_at ?? null }
}

/** عدد الكوبونات الفعّالة والسارية دلوقتي (شرط التشغيل). */
export async function countLiveCoupons(): Promise<number> {
  const result = await restGet<{ is_active: boolean; starts_at: string | null; ends_at: string | null }>(
    TABLE,
    'select=is_active,starts_at,ends_at&is_active=eq.true&limit=' + String(LIVE_SCAN_LIMIT),
  )
  const now = Date.now()
  return result.rows.filter((row) => isCouponLive({ isActive: row.is_active, startsAt: row.starts_at, endsAt: row.ends_at }, now)).length
}
