/**
 * تحويل صفوف الداتابيز لأنواع @zell/core — **عقد نوعي فقط**.
 *
 * الملف ده مالوش أي اتصال بقاعدة بيانات ومش بيتنادى من أي مكان دلوقتي.
 * وظيفته إنه يحدد الشكل اللي المتجر متوقعه، عشان الطرف اللي بيجهّز
 * طبقة البيانات يعرف يسلّم إيه بالظبط.
 *
 * ⚠️ مكتوب من أعمدة products و settings المعروفة، و**مش متحقق منه مقابل
 * السكيما الفعلية** — التحقق مسؤولية الطرف اللي بيشتغل على قاعدة البيانات.
 *
 * خارج نطاق الملف ده تمامًا: جداول الصور، Storage، RLS، أي كتابة.
 */
import type { StoreProduct, StoreSettings } from '@zell/core'

/** صف جدول products زي ما هو. */
export type ProductRow = {
  id: number
  name_ar: string
  name_en: string | null
  brand: string | null
  description_ar: string | null
  image_url: string | null
  images: unknown
  before_image: string | null
  after_image: string | null
  price_per_meter_piastres: number
  width_cm: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

export function toStoreProduct(row: ProductRow): StoreProduct {
  return {
    id: row.id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    brand: row.brand,
    description_ar: row.description_ar,
    image_url: row.image_url,
    images: asStringArray(row.images),
    before_image: row.before_image,
    after_image: row.after_image,
    price_per_meter_piastres: row.price_per_meter_piastres,
    width_cm: row.width_cm,
    min_length_cm: row.min_length_cm,
    step_cm: row.step_cm,
    max_length_cm: row.max_length_cm,
  }
}

export function toStoreProducts(rows: ProductRow[]): StoreProduct[] {
  return rows.map(toStoreProduct)
}

/** صف settings — مفتاح/قيمة. */
export type SettingRow = { key: string; value: unknown }

/**
 * ⚠️ المفاتيح العامة بس. المتجر **ما يستقبلش** notify_email ولا telegram_*
 * ولا أي مفتاح تشغيلي. الدالة بتتجاهل أي مفتاح بره القائمة دي.
 */
export const PUBLIC_SETTING_KEYS = [
  'store_name',
  'logo_url',
  'offer_text',
  'whatsapp_number',
  'whatsapp_message',
  'shipping_rates',
  'shipping_default_piastres',
  'free_shipping_threshold_piastres',
] as const

function settingString(map: Map<string, unknown>, key: string, fallback = ''): string {
  const value = map.get(key)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return fallback
}

function settingNumber(map: Map<string, unknown>, key: string, fallback = 0): number {
  const value = map.get(key)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function settingRates(map: Map<string, unknown>, key: string): Record<string, number> {
  const value = map.get(key)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) out[name] = raw
    else if (typeof raw === 'string' && Number.isFinite(Number(raw)) && Number(raw) >= 0) out[name] = Number(raw)
  }
  return out
}

export function toStoreSettings(rows: SettingRow[]): StoreSettings {
  const allowed = new Set<string>(PUBLIC_SETTING_KEYS)
  const map = new Map<string, unknown>()
  for (const row of rows) {
    if (allowed.has(row.key)) map.set(row.key, row.value)
  }

  const shippingRates = settingRates(map, 'shipping_rates')

  return {
    storeName: settingString(map, 'store_name', 'ZELL'),
    logoUrl: settingString(map, 'logo_url'),
    offerText: settingString(map, 'offer_text'),
    whatsappNumber: settingString(map, 'whatsapp_number'),
    whatsappMessage: settingString(map, 'whatsapp_message'),
    shippingRates,
    shippingDefaultPiastres: settingNumber(map, 'shipping_default_piastres', 0),
    freeShippingThresholdPiastres: settingNumber(map, 'free_shipping_threshold_piastres', 0),
    governorates: Object.keys(shippingRates).sort((a, b) => a.localeCompare(b, 'ar')),
  }
}
