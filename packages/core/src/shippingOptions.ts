/**
 * EXPRESS-SHIPPING W2 — الشحن السريع ومدة الشحن (العقد docs/contracts/EXPRESS-SHIPPING.md §٢ و§٤).
 *
 * منطق خالص مشترك بين المتجر (العرض) والاختبارات. **المرجع الوحيد للحساب هو الداتابيز** (zell_create_order)،
 * والدوال هنا بتعيد نفس قواعدها بالحرف علشان اللي العميل بيشوفه = اللي هيتسجّل (CI بيقارن الاتنين على Postgres).
 *
 *   • الإعداد من zell_shipping_options_checkout(): { express_enabled, governorates } — لكل محافظة:
 *     standard_days_min/max · express_enabled · express_price_piastres · express_days_min/max.
 *   • السريع متاح = المفتاح العام + المحافظة متاحة بسعر صحيح 1..100,000,000 ومدة صحيحة 0 ≤ من ≤ لـ ≤ 60.
 *     الشحن = سعر السريع الكامل دايمًا (من غير الحد المجاني). غير كده = مش متاح (الداتابيز بترفض 45431).
 *   • العادي = نفس computeShippingPiastres بالحرف، ومدته الاختيارية (شكل غلط = مفيش مدة، ومابيمنعش الطلب).
 *   • المدة بتبدأ من الشحن الفعلي — ممنوع أي تاريخ وصول أو وعد أسرع من التجهيز أو تنسيق الفني.
 *
 * ⚠️ الملف ده من غير أي import عن قصد: backend/db/ci/0021ex_core_parity.mjs بيستورده مباشرة (node
 *    --experimental-strip-types) ويقارنه بالداتابيز. حساب العادي هنا، و computeShippingPiastres (pricing) بتناديه.
 */

export type ShippingMethod = 'standard' | 'express'

export const SHIPPING_METHOD_LABELS: Readonly<Record<ShippingMethod, string>> = {
  standard: 'شحن عادي',
  express: 'شحن سريع',
}

/** نفس حدود الداتابيز (zell_shipping_options_save و zell_create_order). */
export const SHIPPING_DAYS_MAX = 60
export const EXPRESS_PRICE_MAX_PIASTRES = 100000000
export const SHIPPING_GOVERNORATES_MAX = 60
export const SHIPPING_GOVERNORATE_NAME_MAX = 40

/** سطر ثابت مع فني التركيب — موعد التركيب مش جزء من مدة الشحن. */
export const SHIPPING_INSTALLATION_LINE = 'موعد التركيب بيتحدد بالتنسيق معاك'

export type ShippingDays = { min: number; max: number }

/** الإعداد زي ما الداتابيز بترجّعه (المحافظات خام، والقرار في expressOffer / standardShippingDays). */
export type ShippingOptions = {
  expressEnabled: boolean
  governorates: Readonly<Record<string, unknown>>
}

export type ExpressOffer = { pricePiastres: number; days: ShippingDays }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const PRICE_TEXT = /^[1-9][0-9]{0,8}$/
const DAYS_TEXT = /^[0-9]{1,2}$/

/** رقم JSON صحيح بنفس فحص النص في الداتابيز (jsonb_typeof = number + regex على النص). */
function jsonInt(value: unknown, pattern: RegExp): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return pattern.test(String(value)) ? value : null
}

function governorateConfig(options: ShippingOptions | null, governorate: string): Record<string, unknown> | null {
  if (options === null) return null
  if (!Object.prototype.hasOwnProperty.call(options.governorates, governorate)) return null
  const cfg = options.governorates[governorate]
  return isPlainObject(cfg) ? cfg : null
}

/** رد zell_shipping_options_checkout(). أي شكل تاني = null («القراية فشلت»: الاختيار مايظهرش والطلب عادي). */
export function parseShippingOptions(raw: unknown): ShippingOptions | null {
  if (!isPlainObject(raw)) return null
  const enabled = raw['express_enabled']
  const governorates = raw['governorates']
  if (typeof enabled !== 'boolean' || !isPlainObject(governorates)) return null
  return { expressEnabled: enabled, governorates }
}

/** السريع للمحافظة دي — نفس شرط zell_create_order بالحرف. null = مش متاح. */
export function expressOffer(options: ShippingOptions | null, governorate: string): ExpressOffer | null {
  if (options === null || !options.expressEnabled) return null
  const cfg = governorateConfig(options, governorate)
  if (cfg === null || cfg['express_enabled'] !== true) return null
  const price = jsonInt(cfg['express_price_piastres'], PRICE_TEXT)
  const min = jsonInt(cfg['express_days_min'], DAYS_TEXT)
  const max = jsonInt(cfg['express_days_max'], DAYS_TEXT)
  if (price === null || min === null || max === null) return null
  if (price > EXPRESS_PRICE_MAX_PIASTRES || min > max || max > SHIPPING_DAYS_MAX) return null
  return { pricePiastres: price, days: { min, max } }
}

/** مدة الشحن العادي (اختيارية). شكل غلط = null، ومابتمنعش الطلب أبدًا. */
export function standardShippingDays(options: ShippingOptions | null, governorate: string): ShippingDays | null {
  const cfg = governorateConfig(options, governorate)
  if (cfg === null) return null
  const min = jsonInt(cfg['standard_days_min'], DAYS_TEXT)
  const max = jsonInt(cfg['standard_days_max'], DAYS_TEXT)
  if (min === null || max === null || min > max || max > SHIPPING_DAYS_MAX) return null
  return { min, max }
}

/** الشحن العادي للعرض — نفس zell_create_order: سعر المحافظة، أو صفر لو الأصناف (قبل الخصم) ≥ الحد المجاني. */
export function standardShippingPiastres(
  governorate: string,
  subtotalPiastres: number,
  rates: Record<string, number>,
  defaultPiastres: number,
  freeThresholdPiastres: number,
): number {
  const fallback = Number.isFinite(defaultPiastres) && defaultPiastres > 0 ? defaultPiastres : 0
  if (freeThresholdPiastres > 0 && subtotalPiastres >= freeThresholdPiastres) return 0
  const rate = rates[governorate]
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 ? rate : fallback
}

export type ShippingQuoteInput = {
  governorate: string
  subtotalPiastres: number
  rates: Record<string, number>
  defaultPiastres: number
  freeThresholdPiastres: number
}

/** الشحن للعرض حسب الطريقة. السريع = سعره الكامل (من غير حد مجاني)، أو null لو مش متاح. */
export function shippingForMethod(method: ShippingMethod, input: ShippingQuoteInput, options: ShippingOptions | null): number | null {
  if (method === 'express') {
    const offer = expressOffer(options, input.governorate)
    return offer === null ? null : offer.pricePiastres
  }
  return standardShippingPiastres(input.governorate, input.subtotalPiastres, input.rates, input.defaultPiastres, input.freeThresholdPiastres)
}

/** «خلال 3–5 يوم من الشحن» — المدة بتبدأ من الشحن الفعلي، ومفيش تاريخ وصول. */
export function shippingDaysLine(days: ShippingDays): string {
  return days.min === days.max
    ? 'خلال ' + String(days.max) + ' يوم من الشحن'
    : 'خلال ' + String(days.min) + '–' + String(days.max) + ' يوم من الشحن'
}

/**
 * حقل shippingMethod في body /api/orders: غايب أو null = عادي (الـ body القديم بالحرف) · 'express' = سريع.
 * أي قيمة تانية (ومنها 'standard' — المتجر عمره ما بيبعتها) = رفض.
 */
export function parseShippingMethodField(value: unknown): { ok: true; method: ShippingMethod } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, method: 'standard' }
  if (value === 'express') return { ok: true, method: 'express' }
  return { ok: false }
}

/** لقطة الطلب (orders.shipping_method / shipping_days_min / shipping_days_max). null = طلب قبل الميزة أو شكل غلط. */
export function parseShippingSnapshot(method: unknown, daysMin: unknown, daysMax: unknown): { method: ShippingMethod; days: ShippingDays | null } | null {
  if (method !== 'standard' && method !== 'express') return null
  const min = typeof daysMin === 'number' && Number.isInteger(daysMin) ? daysMin : null
  const max = typeof daysMax === 'number' && Number.isInteger(daysMax) ? daysMax : null
  const days = min !== null && max !== null && min >= 0 && min <= max && max <= SHIPPING_DAYS_MAX ? { min, max } : null
  return { method, days }
}

/** سطر النوع والمدة للعرض (الإيصال · تيليجرام · اللوحة). */
export function shippingSnapshotLine(snapshot: { method: ShippingMethod; days: ShippingDays | null }): string {
  return SHIPPING_METHOD_LABELS[snapshot.method] + (snapshot.days !== null ? ' · ' + shippingDaysLine(snapshot.days) : '')
}
