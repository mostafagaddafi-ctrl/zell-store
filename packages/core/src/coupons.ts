/**
 * أكواد الخصم (0019) — منطق صافي للعرض والتقدير في المتجر بس.
 *
 * ⚠️ الحكم النهائي في zell_create_order (الداتابيز): المتصفح بيبعت الكود بس، ومفيش أي مبلغ خصم
 *    جاي من السيرفر أو المتصفح بيتصدّق. الحساب هنا تقدير للعرض، ولازم يفضل مطابق لـ0019 بالحرف
 *    (نفس الحساب في الدالة وفي قيد orders_discount_shape):
 *      percent → least(round(subtotal × percent ÷ 100), coalesce(max, subtotal), subtotal)
 *      fixed   → least(amount, subtotal)
 *    round في PostgreSQL على numeric = نصّ القرش لبعيد عن الصفر (6172.5 → 6173).
 * ⚠️ الخصم على الأصناف بس (subtotal) — مش على الشحن ولا أجر الفني ولا الانتقال.
 *    والشحن المجاني بيتحسب على subtotal قبل الخصم (برّه الملف ده).
 * ⚠️ المتجر لازم يبعت ناتج normalizeCouponCode بالظبط — الداتابيز بتطبّع NFC + btrim + upper،
 *    والتطبيع هنا أضيق (حروف لاتيني وأرقام بس) فمفيش كود يتقبل هنا ويترفض هناك بسبب الشكل.
 */

export type CouponKind = 'percent' | 'fixed'

/** نفس قيد coupons_code_shape وفحص الدالة في 0019. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/
/** حدود 0019 بالحرف (coupons_kind_shape · coupons_min_subtotal_range). */
export const COUPON_MAX_PERCENT = 90
export const COUPON_MAX_AMOUNT_PIASTRES = 10000000
export const COUPON_MAX_MIN_SUBTOTAL_PIASTRES = 100000000

/** شروط كوبون صالحة — شكل النوعين منفصل، وحقول النوع التاني null دايمًا. */
export type CouponTerms =
  | {
      code: string
      kind: 'percent'
      percentOff: number
      amountOffPiastres: null
      maxDiscountPiastres: number | null
      minSubtotalPiastres: number
    }
  | {
      code: string
      kind: 'fixed'
      percentOff: null
      amountOffPiastres: number
      maxDiscountPiastres: null
      minSubtotalPiastres: number
    }

/** نتيجة التقدير — من غير استثناءات. */
export type CouponDiscountResult =
  | { status: 'ok'; discountPiastres: number }
  | { status: 'below_minimum'; minSubtotalPiastres: number }
  | { status: 'not_applicable' }
  | { status: 'invalid_terms' }

/** حروف لاتيني وأرقام و - و _ بس (قبل الحروف الكبيرة) — يمنع تحويلات زي ß → SS أو ı → I. */
const COUPON_INPUT_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * NFC ← trim ← uppercase. الفاضي أو أي شكل غير صالح (عربي · مسافة جوه · قصير · طويل · مش نص) = null.
 */
export function normalizeCouponCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.normalize('NFC').trim()
  if (trimmed === '' || !COUPON_INPUT_PATTERN.test(trimmed)) return null
  const code = trimmed.toUpperCase()
  return COUPON_CODE_PATTERN.test(code) ? code : null
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

/** شروط صالحة بحدود 0019 بالحرف، والكود متطبّع فعلًا. */
export function isValidCouponTerms(terms: unknown): terms is CouponTerms {
  if (typeof terms !== 'object' || terms === null) return false
  const t = terms as Record<string, unknown>
  const code = t['code']
  if (typeof code !== 'string' || normalizeCouponCode(code) !== code) return false
  if (!isIntIn(t['minSubtotalPiastres'], 0, COUPON_MAX_MIN_SUBTOTAL_PIASTRES)) return false
  if (t['kind'] === 'percent') {
    const max = t['maxDiscountPiastres']
    return (
      isIntIn(t['percentOff'], 1, COUPON_MAX_PERCENT) &&
      t['amountOffPiastres'] === null &&
      (max === null || isIntIn(max, 1, COUPON_MAX_AMOUNT_PIASTRES))
    )
  }
  if (t['kind'] === 'fixed') {
    return (
      isIntIn(t['amountOffPiastres'], 1, COUPON_MAX_AMOUNT_PIASTRES) &&
      t['percentOff'] === null &&
      t['maxDiscountPiastres'] === null
    )
  }
  return false
}

/** round(n ÷ 100) نصّ لبعيد عن الصفر — integers بس (n ≥ 0)، زي round في PostgreSQL على numeric. */
function roundDiv100(n: number): number {
  const quotient = Math.floor(n / 100)
  const remainder = n - quotient * 100
  return remainder * 2 >= 100 ? quotient + 1 : quotient
}

/**
 * مبلغ الخصم التقديري على الأصناف بس — نفس 0019:
 *   شروط أو subtotal مش صالحين → invalid_terms
 *   subtotal < الحد الأدنى       → below_minimum (الحد الأدنى على الأصناف قبل الخصم)
 *   الخصم < ١ قرش               → not_applicable
 * subtotal × percent ≤ 2^31 × 90 — أقل من 2^53، فالحساب integer بالظبط.
 */
export function couponDiscountPiastres(terms: CouponTerms, subtotalPiastres: number): CouponDiscountResult {
  if (!isValidCouponTerms(terms)) return { status: 'invalid_terms' }
  if (!isIntIn(subtotalPiastres, 0, 2147483647)) return { status: 'invalid_terms' }
  if (subtotalPiastres < terms.minSubtotalPiastres) {
    return { status: 'below_minimum', minSubtotalPiastres: terms.minSubtotalPiastres }
  }
  let discount: number
  if (terms.kind === 'percent') {
    const rounded = roundDiv100(subtotalPiastres * terms.percentOff)
    discount = Math.min(rounded, terms.maxDiscountPiastres ?? subtotalPiastres, subtotalPiastres)
  } else {
    discount = Math.min(terms.amountOffPiastres, subtotalPiastres)
  }
  if (discount < 1) return { status: 'not_applicable' }
  return { status: 'ok', discountPiastres: discount }
}

/** مفاتيح رد zell_preview_coupon بالظبط — أي مفتاح زيادة (زي مبلغ خصم جاهز) = رد مرفوض. */
const PREVIEW_KEYS = [
  'ok',
  'code',
  'kind',
  'percent_off',
  'amount_off_piastres',
  'max_discount_piastres',
  'min_subtotal_piastres',
] as const

/**
 * رد zell_preview_coupon الخام (snake_case) → شروط صالحة، أو null.
 * مابيثقش في الشكل: المفاتيح بالظبط، ok = true، الكود متطبّع، الأرقام integers بحدود 0019،
 * وحقول النوع التاني لازم null. مابيقبلش أي مبلغ خصم من السيرفر — الحساب في couponDiscountPiastres.
 */
export function parseCouponPreview(raw: unknown): CouponTerms | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const keys = Object.keys(r)
  if (keys.length !== PREVIEW_KEYS.length || !PREVIEW_KEYS.every((key) => keys.includes(key))) return null
  if (r['ok'] !== true) return null

  const code = r['code']
  const kind = r['kind']
  const percentOff = r['percent_off']
  const amountOff = r['amount_off_piastres']
  const maxDiscount = r['max_discount_piastres']
  const minSubtotal = r['min_subtotal_piastres']
  if (typeof code !== 'string' || !isIntIn(minSubtotal, 0, COUPON_MAX_MIN_SUBTOTAL_PIASTRES)) return null

  let terms: CouponTerms
  if (kind === 'percent') {
    if (!isIntIn(percentOff, 1, COUPON_MAX_PERCENT) || amountOff !== null) return null
    const max = maxDiscount === null ? null : isIntIn(maxDiscount, 1, COUPON_MAX_AMOUNT_PIASTRES) ? maxDiscount : undefined
    if (max === undefined) return null
    terms = {
      code,
      kind: 'percent',
      percentOff,
      amountOffPiastres: null,
      maxDiscountPiastres: max,
      minSubtotalPiastres: minSubtotal,
    }
  } else if (kind === 'fixed') {
    if (!isIntIn(amountOff, 1, COUPON_MAX_AMOUNT_PIASTRES) || percentOff !== null || maxDiscount !== null) return null
    terms = {
      code,
      kind: 'fixed',
      percentOff: null,
      amountOffPiastres: amountOff,
      maxDiscountPiastres: null,
      minSubtotalPiastres: minSubtotal,
    }
  } else {
    return null
  }
  return isValidCouponTerms(terms) ? terms : null
}
