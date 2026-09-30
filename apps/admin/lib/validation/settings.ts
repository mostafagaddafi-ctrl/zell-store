import 'server-only'

import { invalid, optionalText, requiredText, wholeNumber, type ValidationFailure } from './shared'

/**
 * تحقق الشحن والهوية.
 *
 * الحدود هنا **مرآة** لللي zell_save_shipping و zell_save_identity
 * بيطبقوه، وأضيق منه في حاجتين:
 *
 *   ١. قيم أسعار الشحن: الدالة بتتحقق إن p_rates كائن **وبس** —
 *      مابتفحصش القيم جواه. فالملف ده هو الحارس الوحيد إن كل سعر
 *      عدد صحيح غير سالب.
 *   ٢. رقم الواتساب: الدالة بتفحص الطول بس. هنا بنفحص الشكل كمان.
 *
 * الغرض من المرآة: الرفض ييجي برسالة عربية من التطبيق، مش استثناء
 * من الداتابيز ماينفعش يتعرض.
 */

export type ShippingInput = {
  rates: Record<string, number>
  defaultPiastres: number
  freeThresholdPiastres: number
  disabled: string[]
}

export type IdentityInput = {
  storeName: string
  offerText: string
  whatsappNumber: string
  whatsappMessage: string
}

const MAX_GOVERNORATES = 60
const MAX_GOVERNORATE_LENGTH = 60
/** الحد الأقصى لسعر الشحن — ١٠٠٠٠٠٠ قرش يعني ١٠٠٠٠ جنيه. */
const MAX_PIASTRES = 1000000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateRates(value: unknown): { ok: true; value: Record<string, number> } | ValidationFailure {
  if (!isRecord(value)) return invalid('أسعار الشحن لازم تكون قائمة محافظات وأسعار')

  const entries = Object.entries(value)
  if (entries.length > MAX_GOVERNORATES) return invalid('عدد المحافظات أكبر من المسموح')

  const out: Record<string, number> = {}
  for (const entry of entries) {
    const name = entry[0].trim()
    if (name === '') return invalid('في محافظة من غير اسم')
    if (name.length > MAX_GOVERNORATE_LENGTH) return invalid('اسم محافظة أطول من المسموح')

    const price = wholeNumber(entry[1], 'سعر شحن ' + name)
    if (!price.ok) return price
    if (price.value < 0) return invalid('سعر شحن ' + name + ' ماينفعش يكون سالب')
    if (price.value > MAX_PIASTRES) return invalid('سعر شحن ' + name + ' أكبر من المسموح')

    out[name] = price.value
  }
  return { ok: true, value: out }
}

function validateDisabled(value: unknown): { ok: true; value: string[] } | ValidationFailure {
  if (!Array.isArray(value)) return invalid('المحافظات الموقوفة لازم تكون قائمة')
  if (value.length > MAX_GOVERNORATES) return invalid('عدد المحافظات الموقوفة أكبر من المسموح')

  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') return invalid('كل محافظة موقوفة لازم تكون نص')
    const name = item.trim()
    if (name === '') return invalid('في محافظة موقوفة من غير اسم')
    if (name.length > MAX_GOVERNORATE_LENGTH) return invalid('اسم محافظة موقوفة أطول من المسموح')
    seen.add(name)
  }
  return { ok: true, value: Array.from(seen) }
}

export function validateShipping(input: ShippingInput): { ok: true; value: ShippingInput } | ValidationFailure {
  const rates = validateRates(input.rates)
  if (!rates.ok) return rates

  const defaultPiastres = wholeNumber(input.defaultPiastres, 'سعر الشحن الافتراضي')
  if (!defaultPiastres.ok) return defaultPiastres
  if (defaultPiastres.value < 0) return invalid('سعر الشحن الافتراضي ماينفعش يكون سالب')
  if (defaultPiastres.value > MAX_PIASTRES) return invalid('سعر الشحن الافتراضي أكبر من المسموح')

  const freeThreshold = wholeNumber(input.freeThresholdPiastres, 'حد الشحن المجاني')
  if (!freeThreshold.ok) return freeThreshold
  if (freeThreshold.value < 0) return invalid('حد الشحن المجاني ماينفعش يكون سالب')

  const disabled = validateDisabled(input.disabled)
  if (!disabled.ok) return disabled

  const value: ShippingInput = {
    rates: rates.value,
    defaultPiastres: defaultPiastres.value,
    freeThresholdPiastres: freeThreshold.value,
    disabled: disabled.value,
  }
  return { ok: true, value }
}

/** أرقام بس، وممكن + في الأول. أضيق من فحص الطول في الدالة. */
const PHONE_SHAPE = /^[+]?[0-9]+$/

export function validateIdentity(input: IdentityInput): { ok: true; value: IdentityInput } | ValidationFailure {
  // نفس حدود zell_save_identity بالظبط
  const storeName = requiredText(input.storeName, 'اسم المتجر', 1, 120)
  if (!storeName.ok) return storeName

  const offerText = optionalText(input.offerText, 'نص العرض', 240)
  if (!offerText.ok) return offerText

  const whatsappNumber = optionalText(input.whatsappNumber, 'رقم الواتساب', 20)
  if (!whatsappNumber.ok) return whatsappNumber
  const phone = whatsappNumber.value ?? ''
  if (phone !== '' && !PHONE_SHAPE.test(phone)) {
    return invalid('رقم الواتساب لازم يكون أرقام بس، وممكن + في الأول')
  }

  const whatsappMessage = optionalText(input.whatsappMessage, 'رسالة الواتساب', 500)
  if (!whatsappMessage.ok) return whatsappMessage

  const value: IdentityInput = {
    storeName: storeName.value,
    offerText: offerText.value ?? '',
    whatsappNumber: phone,
    whatsappMessage: whatsappMessage.value ?? '',
  }
  return { ok: true, value }
}
