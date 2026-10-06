/**
 * أكواد الخصم في اللوحة (0019 · PR5) — منطق خالص: تحويل النموذج، والتحقق، وقيود التعديل، والعرض.
 *
 * من غير server-only عن قصد: النموذج بيستخدمه قبل الإرسال، والسيرفر بيعيد **نفس** التحقق قبل
 * أي كتابة (الواجهة مش خط الدفاع). الحدود نفس قيود جدول coupons بالحرف:
 *   coupons_code_shape · coupons_kind_shape · coupons_min_subtotal_range · coupons_max_uses_range ·
 *   coupons_max_uses_per_phone_range · coupons_window · coupons_internal_note_length
 *
 * 🔒 مفيش حذف نهائي: الكوبون بيتوقف بس (is_active = false).
 * 🔒 الكود والنوع مابيتغيروش بعد أول استخدام (أي أوردر بيشاور على الكوبون، حتى الملغي).
 *
 * ⚠️ known limitation (v1): لو أوردر بالكوبون اتسجّل في نفس لحظة حفظ تغيير الكود/النوع، التغيير ممكن
 *    يعدّي (فحص المراجع قبل الكتابة مش في نفس المعاملة). مقبول: الأوردر بيحفظ لقطة الكوبون كاملة،
 *    فالحسابات مابتبوظش.
 * 📝 refactor لاحق: الملف كبر (~500 سطر) — يتقسم (تحقق · عرض · نموذج · لقطة الأوردر) في PR منفصل.
 */

import {
  COUPON_MAX_AMOUNT_PIASTRES,
  COUPON_MAX_MIN_SUBTOTAL_PIASTRES,
  COUPON_MAX_PERCENT,
  normalizeCouponCode,
  type CouponKind,
} from '@zell/core'
import { formatDateTime, formatPiastres } from '../format'

export const COUPON_NOTE_MAX = 500
/** أقصى int4 — حد max_uses و max_uses_per_phone في الداتابيز. */
export const COUPON_COUNT_MAX = 2147483647

export const OWNER_ONLY_MESSAGE = 'إدارة أكواد الخصم للمالك بس.'
export const CODE_TAKEN_MESSAGE = 'الكود ده موجود قبل كده. اختار كود تاني.'
export const ENABLE_NEEDS_LIVE_MESSAGE = 'لازم يكون فيه كوبون واحد فعّال وساري دلوقتي قبل تشغيل أكواد الخصم.'
export const CODE_LOCKED_MESSAGE = 'مينفعش تغيّر الكود بعد أول استخدام — اعمل كوبون جديد.'
export const KIND_LOCKED_MESSAGE = 'مينفعش تغيّر نوع الخصم بعد أول استخدام — اعمل كوبون جديد.'

const MINUS = '\u2212'

type Failure = { ok: false; code: 'VALIDATION'; message: string }

function failure(message: string): Failure {
  return { ok: false, code: 'VALIDATION', message }
}

function intIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

// ── الصلاحية والتشغيل ───────────────────────────────────────

/** المالك بس. أي دور تاني = FORBIDDEN — حتى لو الـaction اتنادى مباشرة من غير الواجهة. */
export function ownerGate(role: string): { ok: false; code: 'FORBIDDEN'; message: string } | null {
  return role === 'owner' ? null : { ok: false, code: 'FORBIDDEN', message: OWNER_ONLY_MESSAGE }
}

/** فعّال وساري دلوقتي: is_active، والبداية عدّت (أو مفيش)، والنهاية لسه (أو مفيش) — نافذة نص مفتوحة زي 0019. */
export function isCouponLive(coupon: { isActive: boolean; startsAt: string | null; endsAt: string | null }, nowMs: number): boolean {
  if (!coupon.isActive) return false
  if (coupon.startsAt !== null && !(Date.parse(coupon.startsAt) <= nowMs)) return false
  if (coupon.endsAt !== null && !(Date.parse(coupon.endsAt) > nowMs)) return false
  return true
}

/** التشغيل محتاج كوبون ساري واحد على الأقل. الإيقاف مسموح دايمًا. */
export function enableGate(enabled: boolean, liveCount: number): Failure | null {
  return enabled && liveCount < 1 ? failure(ENABLE_NEEDS_LIVE_MESSAGE) : null
}

/** الكود والنوع مقفولين بعد أول استخدام (references = كل الأوردرات اللي بتشاور على الكوبون). */
export function lockedFieldsError(
  existing: { code: string; kind: string },
  next: { code: string; kind: string },
  references: number,
): string | null {
  if (references <= 0) return null
  if (existing.code !== next.code) return CODE_LOCKED_MESSAGE
  if (existing.kind !== next.kind) return KIND_LOCKED_MESSAGE
  return null
}

/** معرّف bigint كنص أرقام بس — مفيش أي حاجة تانية بتدخل الفلتر. */
export function parseCouponId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  return typeof text === 'string' && /^[1-9][0-9]{0,17}$/.test(text) ? text : null
}

// ── التحقق: المدخلات → صف الكتابة ───────────────────────────

export type CouponInput = {
  code: string
  kind: CouponKind
  percentOff: number | null
  amountOffPiastres: number | null
  maxDiscountPiastres: number | null
  minSubtotalPiastres: number
  startsAt: string | null
  endsAt: string | null
  maxUses: number | null
  /** null = من غير حد. ناقص = 1 (نفس الافتراضي في الداتابيز). */
  maxUsesPerPhone: number | null
  isActive: boolean
  internalNote: string
}

export type CouponWrite = {
  code: string
  kind: CouponKind
  percent_off: number | null
  amount_off_piastres: number | null
  max_discount_piastres: number | null
  min_subtotal_piastres: number
  starts_at: string | null
  ends_at: string | null
  max_uses: number | null
  max_uses_per_phone: number | null
  is_active: boolean
  internal_note: string | null
}

function optionalCount(value: unknown, label: string): { ok: true; value: number | null } | Failure {
  if (value === null) return { ok: true, value: null }
  if (!intIn(value, 1, COUPON_COUNT_MAX)) return failure(label + ' لازم يكون رقم صحيح ١ أو أكتر، أو فاضي (من غير حد)')
  return { ok: true, value }
}

function optionalInstant(value: unknown, label: string): { ok: true; value: string | null } | Failure {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return failure(label + ' غير صالح')
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return failure(label + ' غير صالح')
  return { ok: true, value: new Date(ms).toISOString() }
}

export function validateCouponInput(raw: unknown): { ok: true; value: CouponWrite } | Failure {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return failure('بيانات الكوبون غير صالحة')
  const r = raw as Record<string, unknown>

  const code = normalizeCouponCode(r['code'])
  if (code === null) return failure('الكود من ٤ لـ ٣٢ حرف: حروف إنجليزي وأرقام و - و _ بس')

  const kind = r['kind']
  if (kind !== 'percent' && kind !== 'fixed') return failure('اختار نوع الخصم: نسبة أو مبلغ ثابت')

  let percentOff: number | null = null
  let amountOff: number | null = null
  let maxDiscount: number | null = null
  if (kind === 'percent') {
    const percent = r['percentOff']
    if (!intIn(percent, 1, COUPON_MAX_PERCENT)) return failure('النسبة لازم تكون رقم صحيح من ١ لـ ٩٠')
    percentOff = percent
    if (r['amountOffPiastres'] !== null && r['amountOffPiastres'] !== undefined) return failure('الخصم بالنسبة مالوش مبلغ ثابت')
    const cap = r['maxDiscountPiastres']
    if (cap !== null && cap !== undefined) {
      if (!intIn(cap, 1, COUPON_MAX_AMOUNT_PIASTRES)) return failure('أقصى خصم لازم يكون من ٠٫٠١ لـ ١٠٠٬٠٠٠ جنيه، أو فاضي')
      maxDiscount = cap
    }
  } else {
    const amount = r['amountOffPiastres']
    if (!intIn(amount, 1, COUPON_MAX_AMOUNT_PIASTRES)) return failure('مبلغ الخصم لازم يكون من ٠٫٠١ لـ ١٠٠٬٠٠٠ جنيه')
    amountOff = amount
    if (r['percentOff'] !== null && r['percentOff'] !== undefined) return failure('المبلغ الثابت مالوش نسبة')
    if (r['maxDiscountPiastres'] !== null && r['maxDiscountPiastres'] !== undefined) return failure('أقصى خصم للنسبة بس')
  }

  const minSubtotal = r['minSubtotalPiastres']
  if (!intIn(minSubtotal, 0, COUPON_MAX_MIN_SUBTOTAL_PIASTRES)) return failure('الحد الأدنى لازم يكون من ٠ لـ ١٬٠٠٠٬٠٠٠ جنيه')

  const startsAt = optionalInstant(r['startsAt'], 'تاريخ البداية')
  if (!startsAt.ok) return startsAt
  const endsAt = optionalInstant(r['endsAt'], 'تاريخ النهاية')
  if (!endsAt.ok) return endsAt
  if (startsAt.value !== null && endsAt.value !== null && !(Date.parse(endsAt.value) > Date.parse(startsAt.value))) {
    return failure('تاريخ النهاية لازم يكون بعد البداية')
  }

  const maxUses = optionalCount(r['maxUses'] ?? null, 'الحد الإجمالي')
  if (!maxUses.ok) return maxUses
  const perPhone = optionalCount(r['maxUsesPerPhone'] === undefined ? 1 : r['maxUsesPerPhone'], 'الحد لكل موبايل')
  if (!perPhone.ok) return perPhone

  const isActive = r['isActive']
  if (typeof isActive !== 'boolean') return failure('حالة الكوبون لازم تكون فعّال أو متوقف')

  const rawNote = r['internalNote']
  if (rawNote !== null && rawNote !== undefined && typeof rawNote !== 'string') return failure('الملاحظة الداخلية غير صالحة')
  const note = typeof rawNote === 'string' ? rawNote.trim() : ''
  // char_length في Postgres بيعد حروف (code points) — مش وحدات UTF-16
  if (Array.from(note).length > COUPON_NOTE_MAX) return failure('الملاحظة الداخلية أطول من ٥٠٠ حرف')

  return {
    ok: true,
    value: {
      code,
      kind,
      percent_off: percentOff,
      amount_off_piastres: amountOff,
      max_discount_piastres: maxDiscount,
      min_subtotal_piastres: minSubtotal,
      starts_at: startsAt.value,
      ends_at: endsAt.value,
      max_uses: maxUses.value,
      max_uses_per_phone: perPhone.value,
      is_active: isActive,
      internal_note: note === '' ? null : note,
    },
  }
}

// ── القراءة والعرض ──────────────────────────────────────────

export type CouponRow = {
  id: number | string
  code: string
  kind: string
  percent_off: number | null
  amount_off_piastres: number | null
  max_discount_piastres: number | null
  min_subtotal_piastres: number
  starts_at: string | null
  ends_at: string | null
  max_uses: number | null
  max_uses_per_phone: number | null
  is_active: boolean
  internal_note: string | null
  created_at: string
  updated_at: string
  /**
   * عدّادين في نفس طلب PostgREST (مفيش N+1) — نفس العلاقة orders باسمين:
   *   uses:orders(count) مع uses.status=neq.cancelled → غير الملغية (العرض وحدود الاستخدام)
   *   references:orders(count) من غير فلتر          → كل الأوردرات، حتى الملغية (قفل الكود والنوع)
   */
  uses?: Array<{ count: number }>
  references?: Array<{ count: number }>
}

export type AdminCoupon = {
  id: string
  code: string
  kind: CouponKind
  percentOff: number | null
  amountOffPiastres: number | null
  maxDiscountPiastres: number | null
  minSubtotalPiastres: number
  startsAt: string | null
  endsAt: string | null
  maxUses: number | null
  maxUsesPerPhone: number | null
  isActive: boolean
  internalNote: string
  /** أوردرات غير ملغية بس — للعرض، مفيش عدّاد بيتعدّل. */
  uses: number
  /** كل الأوردرات اللي بتشاور على الكوبون، حتى الملغية — أكتر من صفر = الكود والنوع مقفولين. */
  references: number
  createdAt: string
  updatedAt: string
}

function embeddedCount(value: Array<{ count: number }> | undefined): number {
  const counted = value?.[0]?.count
  return typeof counted === 'number' && Number.isSafeInteger(counted) && counted >= 0 ? counted : 0
}

/** الكود والنوع مقفولين في النموذج — نفس قاعدة السيرفر (كل المراجع، حتى الملغية). */
export function couponIdentityLocked(coupon: { references: number }): boolean {
  return coupon.references > 0
}

export function toAdminCoupon(row: CouponRow): AdminCoupon {
  return {
    id: String(row.id),
    code: row.code,
    kind: row.kind === 'fixed' ? 'fixed' : 'percent',
    percentOff: row.percent_off,
    amountOffPiastres: row.amount_off_piastres,
    maxDiscountPiastres: row.max_discount_piastres,
    minSubtotalPiastres: row.min_subtotal_piastres,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    maxUses: row.max_uses,
    maxUsesPerPhone: row.max_uses_per_phone,
    isActive: row.is_active,
    internalNote: row.internal_note ?? '',
    uses: embeddedCount(row.uses),
    references: embeddedCount(row.references),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** «10% · أقصى خصم 100 ج.م» أو «50 ج.م». */
export function couponValueLabel(coupon: {
  kind: CouponKind | null
  percentOff: number | null
  amountOffPiastres: number | null
  maxDiscountPiastres: number | null
}): string {
  if (coupon.kind === 'percent' && coupon.percentOff !== null) {
    return String(coupon.percentOff) + '%' + (coupon.maxDiscountPiastres !== null ? ' · أقصى خصم ' + formatPiastres(coupon.maxDiscountPiastres) : '')
  }
  if (coupon.kind === 'fixed' && coupon.amountOffPiastres !== null) return formatPiastres(coupon.amountOffPiastres)
  return '—'
}

export function couponWindowLabel(coupon: { startsAt: string | null; endsAt: string | null }): string {
  if (coupon.startsAt === null && coupon.endsAt === null) return 'من غير مدة'
  const from = coupon.startsAt === null ? 'دلوقتي' : formatDateTime(coupon.startsAt)
  const to = coupon.endsAt === null ? 'من غير نهاية' : formatDateTime(coupon.endsAt)
  return from + ' ← ' + to
}

export function couponLimitLabel(limit: number | null): string {
  return limit === null ? 'من غير حد' : String(limit)
}

// ── النموذج: نصوص الخانات ↔ المدخلات ───────────────────────

export type CouponFormState = {
  code: string
  kind: CouponKind
  percent: string
  /** جنيه */
  cap: string
  amount: string
  minSubtotal: string
  /** datetime-local بتوقيت الجهاز */
  startsAt: string
  endsAt: string
  maxUses: string
  /** فاضي = من غير حد */
  maxUsesPerPhone: string
  isActive: boolean
  note: string
}

export function emptyCouponForm(): CouponFormState {
  return {
    code: '',
    kind: 'percent',
    percent: '',
    cap: '',
    amount: '',
    minSubtotal: '',
    startsAt: '',
    endsAt: '',
    maxUses: '',
    maxUsesPerPhone: '1',
    isActive: true,
    note: '',
  }
}

function poundsText(piastres: number | null): string {
  return piastres === null ? '' : String(piastres / 100)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** ISO → قيمة datetime-local بتوقيت الجهاز (فاضي لو مفيش). */
export function toLocalInput(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return (
    String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  )
}

export function couponToForm(coupon: AdminCoupon): CouponFormState {
  return {
    code: coupon.code,
    kind: coupon.kind,
    percent: coupon.percentOff === null ? '' : String(coupon.percentOff),
    cap: poundsText(coupon.maxDiscountPiastres),
    amount: poundsText(coupon.amountOffPiastres),
    minSubtotal: coupon.minSubtotalPiastres === 0 ? '' : poundsText(coupon.minSubtotalPiastres),
    startsAt: toLocalInput(coupon.startsAt),
    endsAt: toLocalInput(coupon.endsAt),
    maxUses: coupon.maxUses === null ? '' : String(coupon.maxUses),
    maxUsesPerPhone: coupon.maxUsesPerPhone === null ? '' : String(coupon.maxUsesPerPhone),
    isActive: coupon.isActive,
    note: coupon.internalNote,
  }
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

const POUNDS = /^[0-9]{1,9}(?:\.[0-9]{1,2})?$/
const COUNT = /^[0-9]{1,10}$/

/** جنيه بقرشين بالكتير — مفيش تقريب صامت لكسور أصغر. */
function parsePounds(text: string, label: string, optional: boolean): Parsed<number | null> {
  const trimmed = text.trim()
  if (trimmed === '') return optional ? { ok: true, value: null } : { ok: false, message: label + ' مطلوب' }
  if (!POUNDS.test(trimmed)) return { ok: false, message: label + ' لازم يكون رقم بالجنيه (لحد قرشين بعد العلامة)' }
  return { ok: true, value: Math.round(Number(trimmed) * 100) }
}

function parseCount(text: string, label: string): Parsed<number | null> {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (!COUNT.test(trimmed)) return { ok: false, message: label + ' لازم يكون رقم صحيح من غير كسور' }
  return { ok: true, value: Number(trimmed) }
}

function parseLocalInstant(text: string, label: string): Parsed<string | null> {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  const ms = new Date(trimmed).getTime()
  if (!Number.isFinite(ms)) return { ok: false, message: label + ' غير صالح' }
  return { ok: true, value: new Date(ms).toISOString() }
}

/** نصوص الخانات → مدخلات (من غير قص). التحقق الكامل بعدها في validateCouponInput — هنا وفي السيرفر. */
export function formToCouponInput(form: CouponFormState): Parsed<CouponInput> {
  const isPercent = form.kind === 'percent'
  let percentOff: number | null = null
  if (isPercent) {
    const text = form.percent.trim()
    if (!/^[0-9]{1,3}$/.test(text)) return { ok: false, message: 'النسبة لازم تكون رقم صحيح من ١ لـ ٩٠' }
    percentOff = Number(text)
  }
  const cap = isPercent ? parsePounds(form.cap, 'أقصى خصم', true) : ({ ok: true, value: null } as const)
  if (!cap.ok) return cap
  const amount = isPercent ? ({ ok: true, value: null } as const) : parsePounds(form.amount, 'مبلغ الخصم', false)
  if (!amount.ok) return amount
  const minSubtotal = parsePounds(form.minSubtotal, 'الحد الأدنى', true)
  if (!minSubtotal.ok) return minSubtotal
  const startsAt = parseLocalInstant(form.startsAt, 'تاريخ البداية')
  if (!startsAt.ok) return startsAt
  const endsAt = parseLocalInstant(form.endsAt, 'تاريخ النهاية')
  if (!endsAt.ok) return endsAt
  const maxUses = parseCount(form.maxUses, 'الحد الإجمالي')
  if (!maxUses.ok) return maxUses
  const perPhone = parseCount(form.maxUsesPerPhone, 'الحد لكل موبايل')
  if (!perPhone.ok) return perPhone

  return {
    ok: true,
    value: {
      code: form.code,
      kind: form.kind,
      percentOff,
      amountOffPiastres: amount.value,
      maxDiscountPiastres: cap.value,
      minSubtotalPiastres: minSubtotal.value ?? 0,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
      maxUses: maxUses.value,
      maxUsesPerPhone: perPhone.value,
      isActive: form.isActive,
      internalNote: form.note,
    },
  }
}

// ── لقطة الكوبون في الأوردر ─────────────────────────────────

export type OrderCouponSnapshot = {
  code: string
  kind: CouponKind | null
  percentOff: number | null
  amountOffPiastres: number | null
  maxDiscountPiastres: number | null
  discountPiastres: number
}

/** من أعمدة الأوردر (لقطة وقت الطلب). null = أوردر قديم أو من غير كوبون — العرض زي ما هو. */
export function orderCouponSnapshot(row: {
  coupon_code?: unknown
  coupon_kind?: unknown
  coupon_percent?: unknown
  coupon_amount_piastres?: unknown
  coupon_max_discount_piastres?: unknown
  discount_piastres?: unknown
}): OrderCouponSnapshot | null {
  const code = row.coupon_code
  const discount = row.discount_piastres
  if (typeof code !== 'string' || code === '' || !intIn(discount, 1, Number.MAX_SAFE_INTEGER)) return null
  const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null)
  return {
    code,
    kind: row.coupon_kind === 'percent' || row.coupon_kind === 'fixed' ? row.coupon_kind : null,
    percentOff: whole(row.coupon_percent),
    amountOffPiastres: whole(row.coupon_amount_piastres),
    maxDiscountPiastres: whole(row.coupon_max_discount_piastres),
    discountPiastres: discount,
  }
}

export function discountRowLabel(code: string): string {
  return 'خصم (' + code + ')'
}

export function discountRowValue(piastres: number): string {
  return MINUS + formatPiastres(piastres)
}

/** «الأصناف X − الخصم Y + الشحن Z (+ التركيب + الانتقال) = الإجمالي» — الإجمالي من الأوردر نفسه. */
export function orderTotalFormula(parts: {
  subtotalPiastres: number
  discountPiastres: number
  shippingPiastres: number
  installationRequested: boolean
  installationPiastres: number
  installationTravelPiastres: number
  totalPiastres: number
}): string {
  const terms = [
    'الأصناف ' + formatPiastres(parts.subtotalPiastres),
    MINUS + ' الخصم ' + formatPiastres(parts.discountPiastres),
    '+ الشحن ' + formatPiastres(parts.shippingPiastres),
  ]
  if (parts.installationRequested) {
    terms.push('+ التركيب ' + formatPiastres(parts.installationPiastres), '+ الانتقال ' + formatPiastres(parts.installationTravelPiastres))
  }
  return terms.join(' ') + ' = ' + formatPiastres(parts.totalPiastres)
}
