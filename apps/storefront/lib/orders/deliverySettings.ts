import type { PreferredDelivery } from '@zell/core'

/**
 * 0021-D2 — تحكم المالك في موعد التسليم في Checkout (العقد docs/contracts/0021-D2.md §٢-٣).
 *
 * منطق خالص (من غير I/O ولا server-only) علشان الصفحة والراوت والحالات يستخدموا نفس القرار بالحرف.
 * الإعداد بييجي من zell_checkout_delivery_settings() (service_role بس) بالشكل {customer_choice_enabled, note}.
 *
 * 🔒 القرار:
 *   • Checkout: الحقل بيظهر بس لو الإعداد مقروء والاختيار شغّال. السطر بيظهر لو موجود (في الحالتين).
 *     القراية فشلت = الحقل والسطر مخفيين، والطلب شغّال من غير موعد.
 *   • /api/orders (الحارس الحقيقي): من غير موعد = مفيش قراية خالص، والطلب بيكمّل زي النهارده.
 *     بموعد: مقروء وشغّال = الموعد بيتبعت · مقروء ومقفول = الموعد مابيتبعتش والطلب بيتعمل (ر٢) ·
 *     القراية فشلت = DELIVERY_SETTINGS_UNAVAILABLE (503) من غير نداء zell_create_order (ر٣).
 */

/** نفس حد الداتابيز (zell_delivery_settings.note_text ≤ 300 حرف بعد trim). */
export const DELIVERY_NOTE_MAX = 300

export type CheckoutDeliverySettings = {
  /** العميل يختار الموعد؟ */
  customerChoiceEnabled: boolean
  /** السطر للعميل (null = مخفي). */
  note: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** عدد الحروف زي char_length في Postgres (code points، مش UTF-16). */
function charLength(value: string): number {
  return Array.from(value).length
}

/**
 * شكل صارم: أي حاجة غير {customer_choice_enabled: boolean, note: string | null} = null (يعني «القراية فشلت»).
 * السطر الفاضي بعد trim = مفيش سطر.
 */
export function parseCheckoutDeliverySettings(raw: unknown): CheckoutDeliverySettings | null {
  if (!isPlainObject(raw)) return null
  const choice = raw['customer_choice_enabled']
  if (typeof choice !== 'boolean') return null
  if (!Object.prototype.hasOwnProperty.call(raw, 'note')) return null
  const note = raw['note']
  if (note === null) return { customerChoiceEnabled: choice, note: null }
  if (typeof note !== 'string') return null
  const trimmed = note.trim()
  if (trimmed === '') return { customerChoiceEnabled: choice, note: null }
  if (charLength(trimmed) > DELIVERY_NOTE_MAX) return null
  return { customerChoiceEnabled: choice, note: trimmed }
}

/** Checkout: حقل الموعد بيظهر بس لو الإعداد مقروء والاختيار شغّال (القراية فشلت = مخفي). */
export function showDeliveryChoice(settings: CheckoutDeliverySettings | null): boolean {
  return settings !== null && settings.customerChoiceEnabled
}

/** Checkout: السطر للعميل لو موجود (القراية فشلت = مخفي). */
export function deliveryNote(settings: CheckoutDeliverySettings | null): string | null {
  return settings === null ? null : settings.note
}

export type DeliveryDecision =
  | { kind: 'send'; preferredDelivery: PreferredDelivery | null; dropped: boolean }
  | { kind: 'unavailable' }

/**
 * قرار الراوت بعد حساب الهاش. requested = الموعد من طلب العميل بعد التطبيع.
 * settings = null يعني القراية فشلت (ومابتتطلبش أصلًا لو مفيش موعد).
 */
export function decideDelivery(requested: PreferredDelivery | null, settings: CheckoutDeliverySettings | null): DeliveryDecision {
  if (requested === null) return { kind: 'send', preferredDelivery: null, dropped: false }
  if (settings === null) return { kind: 'unavailable' }
  if (!settings.customerChoiceEnabled) return { kind: 'send', preferredDelivery: null, dropped: true }
  return { kind: 'send', preferredDelivery: requested, dropped: false }
}
