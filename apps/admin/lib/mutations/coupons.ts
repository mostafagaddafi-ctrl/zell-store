import 'server-only'

import { restGet, restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import {
  CODE_TAKEN_MESSAGE,
  enableGate,
  isCouponLive,
  lockedFieldsError,
  parseCouponId,
  toAdminCoupon,
  validateCouponInput,
  type AdminCoupon,
  type CouponRow,
} from '../coupons/form'
import { flag, invalid, timestamp } from '../validation/shared'
import { patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'

/**
 * أكواد الخصم (0019 · PR5) — القراءة والكتابة على coupons و settings.coupons_enabled.
 *
 * 🔒 الصلاحية (المالك بس) والعلم في lib/couponActions.ts **قبل** أي دالة هنا.
 * 🔒 التحقق هنا تاني من غير ما نثق في الواجهة (validateCouponInput)، والداتابيز عندها نفس القيود.
 * 🔒 مفيش حذف خالص — الإيقاف بس. ومفيش عدّاد استخدام بيتكتب: العدد من الأوردرات غير الملغية.
 * ⚠️ مفيش trigger على updated_at، فـpatchGuarded بيبعته (تزامن تفاؤلي).
 */

const TABLE = 'coupons'
const COLUMNS =
  'id,code,kind,percent_off,amount_off_piastres,max_discount_piastres,min_subtotal_piastres,' +
  'starts_at,ends_at,max_uses,max_uses_per_phone,is_active,internal_note,created_at,updated_at'
/**
 * العدّادين في نفس الطلب (مفيش N+1) — نفس العلاقة باسمين، والفلتر على الاسم الأول بس:
 *   uses = غير الملغية (العرض) · references = كل الأوردرات حتى الملغية (قفل الكود والنوع في النموذج)
 */
const USES = 'uses:orders(count),references:orders(count)&uses.status=neq.cancelled'
export const COUPONS_PAGE_SIZE = 20
const SWITCH_KEY = 'coupons_enabled'
/** سقف قراءة الكوبونات الفعّالة لفحص التشغيل — الجدول صغير، والفحص على ده بس. */
const LIVE_SCAN_LIMIT = 1000

const NOT_FOUND_MESSAGE = 'الكوبون مش موجود. يمكن يكون اتغيّر — حدّث الصفحة.'
const BAD_ID_MESSAGE = 'معرّف الكوبون غير صالح'

export type CouponsPage = { rows: AdminCoupon[]; total: number; page: number; pageSize: number }
export type CouponsSwitch = { enabled: boolean; updatedAt: string | null }

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

async function codeTaken(code: string, exceptId: string | null): Promise<boolean> {
  const parts = ['select=id', 'code=eq.' + encodeURIComponent(code), 'limit=1']
  if (exceptId !== null) parts.push('id=neq.' + exceptId)
  const found = await restGet<{ id: number | string }>(TABLE, parts.join('&'))
  return found.rows.length > 0
}

async function readWithUses(id: string): Promise<AdminCoupon | null> {
  const found = await restGet<CouponRow>(TABLE, 'select=' + COLUMNS + ',' + USES + '&id=eq.' + id + '&limit=1')
  const row = found.rows[0]
  return row ? toAdminCoupon(row) : null
}

export async function createCoupon(raw: unknown): Promise<MutationResult<AdminCoupon>> {
  const input = validateCouponInput(raw)
  if (!input.ok) return input

  try {
    // سابق للقيد coupons_code_key — رسالة واضحة بدل خطأ داخلي (السباق النادر بيقع على القيد نفسه)
    if (await codeTaken(input.value.code, null)) return invalid(CODE_TAKEN_MESSAGE)
    const rows = await restInsert<CouponRow>(TABLE, { ...input.value }, COLUMNS)
    const row = rows[0]
    if (!row) return toInternalFailure(null)
    return { ok: true, data: toAdminCoupon({ ...row, uses: [{ count: 0 }], references: [{ count: 0 }] }) }
  } catch (error) {
    return toInternalFailure(error)
  }
}

export async function updateCoupon(rawId: unknown, raw: unknown, rawStamp: unknown): Promise<MutationResult<AdminCoupon>> {
  const id = parseCouponId(rawId)
  if (id === null) return invalid(BAD_ID_MESSAGE)
  const input = validateCouponInput(raw)
  if (!input.ok) return input
  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  try {
    const current = await restGet<{ code: string; kind: string }>(TABLE, 'select=code,kind&id=eq.' + id + '&limit=1')
    const existing = current.rows[0]
    if (!existing) return { ok: false, code: 'NOT_FOUND', message: NOT_FOUND_MESSAGE }

    // الكود والنوع مقفولين بعد أول استخدام — أي أوردر بيشاور على الكوبون (حتى الملغي). فحص طازة هنا
    // مش من القايمة. known limitation v1: أوردر في نفس لحظة الحفظ ممكن يسبق الكتابة — لقطته ثابتة فمفيش ضرر.
    const references = await restGet<{ id: number }>('orders', 'select=id&coupon_id=eq.' + id + '&limit=1', { exactCount: true })
    const locked = lockedFieldsError(existing, input.value, references.total ?? references.rows.length)
    if (locked !== null) return invalid(locked)

    if (input.value.code !== existing.code && (await codeTaken(input.value.code, id))) return invalid(CODE_TAKEN_MESSAGE)

    const result = await patchGuarded<CouponRow>({
      table: TABLE,
      idColumn: 'id',
      idValue: id,
      expectedUpdatedAt: stamp.value,
      changes: { ...input.value },
      select: 'id',
    })
    if (!result.ok) return result

    const fresh = await readWithUses(id)
    if (fresh === null) return toInternalFailure(null)
    return { ok: true, data: fresh }
  } catch (error) {
    return toInternalFailure(error)
  }
}

/** تفعيل أو إيقاف — بديل الحذف الوحيد. */
export async function setCouponActive(rawId: unknown, rawActive: unknown, rawStamp: unknown): Promise<MutationResult<AdminCoupon>> {
  const id = parseCouponId(rawId)
  if (id === null) return invalid(BAD_ID_MESSAGE)
  const active = flag(rawActive, 'حالة الكوبون')
  if (!active.ok) return active
  const stamp = timestamp(rawStamp, 'طابع آخر تعديل')
  if (!stamp.ok) return stamp

  try {
    const result = await patchGuarded<CouponRow>({
      table: TABLE,
      idColumn: 'id',
      idValue: id,
      expectedUpdatedAt: stamp.value,
      changes: { is_active: active.value },
      select: 'id',
    })
    if (!result.ok) return result

    const fresh = await readWithUses(id)
    if (fresh === null) return toInternalFailure(null)
    return { ok: true, data: fresh }
  } catch (error) {
    return toInternalFailure(error)
  }
}

/**
 * مفتاح «أكواد الخصم» (settings.coupons_enabled). التشغيل محتاج كوبون ساري واحد على الأقل،
 * والإيقاف مسموح دايمًا. الصف موجود من 0019؛ لو اتمسح بيتعمل. النجاح بيتأكد بالقراءة.
 */
export async function setCouponsEnabled(rawEnabled: unknown): Promise<MutationResult<{ enabled: boolean }>> {
  const enabled = flag(rawEnabled, 'تشغيل أكواد الخصم')
  if (!enabled.ok) return enabled

  try {
    if (enabled.value) {
      const gate = enableGate(true, await countLiveCoupons())
      if (gate !== null) return gate
    }

    const changed = await restPatch<{ key: string }>('settings', 'key=eq.' + SWITCH_KEY, {
      value: enabled.value,
      updated_at: new Date().toISOString(),
    })
    if (changed.length === 0) await restInsert('settings', { key: SWITCH_KEY, value: enabled.value })

    const stored = await readCouponsSwitch()
    if (stored.enabled !== enabled.value) return toInternalFailure(null)
    return { ok: true, data: { enabled: enabled.value } }
  } catch (error) {
    return toInternalFailure(error)
  }
}
