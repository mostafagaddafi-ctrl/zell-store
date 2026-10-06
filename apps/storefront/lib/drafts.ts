/**
 * مسودات العميل في التاب ده بس (sessionStorage) — بتنتهي لوحدها لما التاب يتقفل،
 * والتاب الجديد مابيورثهاش.
 *
 *   مسودة Checkout  → بيانات التوصيل لو العميل راح لأدوات التركيب ورجع (+ كود الخصم المطبّق بس — 0019)
 *   مسودة المقاس    → مقاس كل منتج لو العميل راح للسلة ورجع
 *
 * 🔒 ممنوع هنا أي سر أو حاجة جاية من السيرفر: لا مفتاح النية (idempotency) ولا هاش
 *    ولا رمز جلسة أو إيصال ولا رسايل أخطاء. اللي العميل كتبه بس.
 * ⚠️ التخزين مش موثوق: كل حقل بيتفحص نوعه وحدوده قبل الاسترجاع، وأي حاجة غلط =
 *    المسودة كلها بتتجاهل (من غير قص صامت ومن غير ما نصلّح قيم).
 * ⚠️ الحدود هنا حدود أمان للتخزين — أوسع من حدود الطلب عن قصد عشان مانرميش حاجة
 *    العميل كتبها. التحقق الحقيقي في الفورم والسيرفر زي ما هو.
 */

import { normalizeCouponCode } from '@zell/core'

const CHECKOUT_KEY = 'zell-checkout-draft-v1'
const SIZE_KEY_PREFIX = 'zell-size-draft-v1:'
const VERSION = 1

/** نفس سقف جسم الطلب في /api/orders — مسودة أكبر من كده مش طبيعية. */
const MAX_STORED_CHARS = 16 * 1024

const MAX_NAME = 200
const MAX_PHONE = 40
const MAX_GOVERNORATE = 80
const MAX_AREA = 80
const MAX_ADDRESS = 2000
const MAX_NOTES = 2000
/** 0019 — الكود المطبّق بس (نفس حد الكود في الداتابيز). */
const MAX_COUPON = 32

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (raw === null || raw.length > MAX_STORED_CHARS) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    return record['v'] === VERSION ? record : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: Record<string, unknown>): void {
  try {
    const raw = JSON.stringify({ v: VERSION, ...value })
    if (raw.length > MAX_STORED_CHARS) {
      window.sessionStorage.removeItem(key)
      return
    }
    window.sessionStorage.setItem(key, raw)
  } catch {
    // التخزين مقفول أو مليان — المسودة بتضيع بس الصفحة شغالة عادي
  }
}

function removeKey(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // التخزين مقفول — مفيش حاجة تتمسح
  }
}

function boundedText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

// ── Checkout ─────────────────────────────────────────────────
export type CheckoutDraft = {
  customerName: string
  customerPhone: string
  governorate: string
  area: string
  address: string
  notes: string
  showNotes: boolean
  /** 0019 — الكود المطبّق بس (من غير مبلغ ولا شروط). ناقص في التخزين القديم. */
  couponCode?: string
}

export function readCheckoutDraft(): CheckoutDraft | null {
  const record = readJson(CHECKOUT_KEY)
  return record === null ? null : parseCheckoutDraft(record)
}

/** فحص المسودة المقروءة (خالص — بيتختبر من غير sessionStorage). أي حقل غلط = المسودة كلها بتتجاهل. */
export function parseCheckoutDraft(record: Record<string, unknown>): CheckoutDraft | null {
  const customerName = boundedText(record['customerName'], MAX_NAME)
  const customerPhone = boundedText(record['customerPhone'], MAX_PHONE)
  const governorate = boundedText(record['governorate'], MAX_GOVERNORATE)
  const area = boundedText(record['area'], MAX_AREA)
  const address = boundedText(record['address'], MAX_ADDRESS)
  const notes = boundedText(record['notes'], MAX_NOTES)
  const showNotes = record['showNotes']
  if (
    customerName === null ||
    customerPhone === null ||
    governorate === null ||
    area === null ||
    address === null ||
    notes === null ||
    typeof showNotes !== 'boolean'
  ) {
    return null
  }
  // 0019 — ناقص = تخزين قديم (صالح). موجود لازم يبقى كود متطبّع بالظبط وفي حده، وإلا المسودة كلها بتتجاهل
  const rawCoupon = record['couponCode']
  let couponCode: string | undefined
  if (rawCoupon !== undefined) {
    const bounded = boundedText(rawCoupon, MAX_COUPON)
    if (bounded === null || normalizeCouponCode(bounded) !== bounded) return null
    couponCode = bounded
  }
  const draft: CheckoutDraft = { customerName, customerPhone, governorate, area, address, notes, showNotes }
  if (couponCode !== undefined) draft.couponCode = couponCode
  return draft
}

export function saveCheckoutDraft(draft: CheckoutDraft): void {
  writeJson(CHECKOUT_KEY, { ...draft })
}

export function clearCheckoutDraft(): void {
  removeKey(CHECKOUT_KEY)
}

// ── المقاس (لكل منتج) ────────────────────────────────────────
export type SizeDraft = {
  /** بصمة قواعد المقاس وقت الحفظ — لو اتغيّرت من اللوحة المسودة بتتجاهل. */
  rules: string
  widthCm: number
  mode: 'window' | 'length'
  windowWidth: string
  windowHeight: string
  lengthCm: number
}

/** خانة سم زي ما المتصفح بيدّيها: فاضية، أو رقم موجب صغير بكسر عشري اختياري. */
const CM_TEXT = /^(?:[0-9]{1,4}(?:\.[0-9]{1,2})?)?$/
const MAX_RULES = 300
const MAX_CM = 100000

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_CM ? value : null
}

export function readSizeDraft(productId: number): SizeDraft | null {
  const record = readJson(SIZE_KEY_PREFIX + String(productId))
  if (record === null) return null
  const rules = boundedText(record['rules'], MAX_RULES)
  const widthCm = positiveInt(record['widthCm'])
  const lengthCm = positiveInt(record['lengthCm'])
  const mode = record['mode']
  const windowWidth = record['windowWidth']
  const windowHeight = record['windowHeight']
  if (rules === null || widthCm === null || lengthCm === null) return null
  if (mode !== 'window' && mode !== 'length') return null
  if (typeof windowWidth !== 'string' || !CM_TEXT.test(windowWidth)) return null
  if (typeof windowHeight !== 'string' || !CM_TEXT.test(windowHeight)) return null
  return { rules, widthCm, mode, windowWidth, windowHeight, lengthCm }
}

export function saveSizeDraft(productId: number, draft: SizeDraft): void {
  writeJson(SIZE_KEY_PREFIX + String(productId), { ...draft })
}

export function clearSizeDraft(productId: number): void {
  removeKey(SIZE_KEY_PREFIX + String(productId))
}
