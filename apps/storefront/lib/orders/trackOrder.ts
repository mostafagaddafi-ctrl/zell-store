/**
 * TRACK-ORDER W2 — «تتبّع طلبك»: تظبيط الكود اللي العميل كتبه · حارس شكل رد zell_checkout_track_order · نصوص العرض.
 *
 * العقد: docs/contracts/TRACK-ORDER.md §٣ (التظبيط) و§٤ (الصفحة).
 * منطق خالص: من غير server-only ولا شبكة ولا متغيرات بيئة، علشان الحالات تتشغّل فعلًا في CI (suite track).
 *
 *   • التظبيط في السيرفر قبل أي نداء: شيل المسافات والشرط · حروف كبيرة · الطول ٦ = الستة · الطول ٩ وأوله FLM = آخر ٦ ·
 *     غير كده غلط · الستة لازم من أبجدية رقم الطلب. «FLM» مابيتشالش من الأول على طول، لأن الكود نفسه ممكن يبدأ بـ FLM.
 *   • أي إدخال غلط = مفيش نداء للداتابيز، ونفس رسالة «مش موجود».
 *   • الحارس بيبني كائن جديد من المفاتيح المعروفة بس — أي مفتاح زيادة في الرد مابيوصلش للمتصفح.
 */

import {
  CUSTOMER_STATUS_LABELS,
  ORDER_STATUSES,
  PREFERRED_DELIVERY_PENDING,
  formatLength,
  isDeliveryPeriod,
  preferredDeliveryLine,
  type DeliveryPeriod,
  type OrderStatus,
} from '@zell/core'

/** نفس أبجدية رقم الطلب (packages/core/src/orderNumber.ts): من غير O و0 و I و1. */
export const TRACK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** أقصى طول للي العميل يكتبه قبل التظبيط (حماية بس؛ الكود الصحيح أقصاه ١٠ حروف). */
export const TRACK_INPUT_MAX = 40

/** رسالة واحدة لكل الحالات الغلط: شكل غلط · مش موجود · خطأ مؤقت في القراية (العقد §٤). */
export const TRACK_NOT_FOUND_MESSAGE = 'مالقيناش طلب بالكود ده. اتأكد منه وجرّب تاني.'

const ORDER_NUMBER_RE = /^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** اللي العميل كتبه ← «FLM-XXXXXX»، أو null لو غلط (ومفيش نداء). */
export function normalizeTrackCode(raw: string): string | null {
  if (raw.length > TRACK_INPUT_MAX) return null
  const compact = raw.replace(/[\s-]+/g, '').toUpperCase()
  let six: string
  if (compact.length === 6) six = compact
  else if (compact.length === 9 && compact.startsWith('FLM')) six = compact.slice(3)
  else return null
  for (const ch of six) {
    if (!TRACK_ALPHABET.includes(ch)) return null
  }
  return 'FLM-' + six
}

export type TrackedItem = {
  productName: string
  saleUnit: 'meter' | 'piece'
  lengthCm: number | null
  widthCm: number | null
  quantity: number
  lineTotalPiastres: number
}

export type TrackedDelivery = { kind: 'confirmed' | 'preferred'; date: string; period: DeliveryPeriod | null }

export type TrackedOrder = {
  orderNumber: string
  status: OrderStatus
  createdAt: string
  totalPiastres: number
  items: TrackedItem[]
  delivery: TrackedDelivery | null
}

export type TrackState =
  | { status: 'idle' }
  | { status: 'not_found'; message: string }
  | { status: 'found'; order: TrackedOrder }

export const TRACK_INITIAL_STATE: TrackState = { status: 'idle' }

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * حارس كامل لشكل رد zell_checkout_track_order (العقد §٢). أي شكل غير متوقع = null، فالصفحة بتعرض نفس رسالة «مش موجود»
 * من غير ما تقع. بيرجّع كائن جديد بالمفاتيح المعروفة بس.
 */
export function parseTrackedOrder(value: unknown): TrackedOrder | null {
  if (!isPlainObject(value)) return null
  const orderNumber = value['order_number']
  const status = value['status']
  const createdAt = value['created_at']
  const total = value['total_piastres']
  if (typeof orderNumber !== 'string' || !ORDER_NUMBER_RE.test(orderNumber)) return null
  if (!isOrderStatus(status)) return null
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return null
  if (!isInt(total) || total < 0) return null

  const rawItems = value['items']
  if (!Array.isArray(rawItems)) return null
  const items: TrackedItem[] = []
  for (const entry of rawItems) {
    if (!isPlainObject(entry)) return null
    const name = entry['product_name_ar']
    const unit = entry['sale_unit']
    const line = entry['line_total_piastres']
    const width = entry['width_cm']
    if (typeof name !== 'string' || !isInt(line) || line < 0) return null
    if (width !== null && width !== undefined && !(isInt(width) && width > 0)) return null
    if (unit === 'piece') {
      const quantity = entry['quantity']
      if (!isInt(quantity) || quantity < 1) return null
      items.push({ productName: name, saleUnit: 'piece', lengthCm: null, widthCm: null, quantity, lineTotalPiastres: line })
    } else if (unit === 'meter') {
      const length = entry['length_cm']
      if (!isInt(length) || length <= 0) return null
      items.push({ productName: name, saleUnit: 'meter', lengthCm: length, widthCm: isInt(width) ? width : null, quantity: 1, lineTotalPiastres: line })
    } else {
      return null
    }
  }

  if (!('delivery' in value)) return null
  const rawDelivery = value['delivery']
  let delivery: TrackedDelivery | null = null
  if (rawDelivery !== null) {
    if (!isPlainObject(rawDelivery)) return null
    const kind = rawDelivery['kind'] === 'confirmed' ? 'confirmed' : rawDelivery['kind'] === 'preferred' ? 'preferred' : null
    const date = rawDelivery['date']
    const period = rawDelivery['period']
    if (kind === null) return null
    if (typeof date !== 'string' || !DATE_RE.test(date)) return null
    if (period !== null && period !== undefined && !isDeliveryPeriod(period)) return null
    delivery = { kind, date, period: isDeliveryPeriod(period) ? period : null }
  }

  return { orderNumber, status, createdAt, totalPiastres: total, items, delivery }
}

/** اسم الحالة للعميل (CUSTOMER_STATUS_LABELS، مش أسماء اللوحة). */
export function customerStatusLabel(status: OrderStatus): string {
  return CUSTOMER_STATUS_LABELS[status]
}

/** المقاس أو العدد تحت اسم المنتج. */
export function trackItemSpec(item: TrackedItem): string {
  if (item.saleUnit === 'piece') return 'الكمية ' + String(item.quantity)
  const length = formatLength(item.lengthCm ?? 0)
  return item.widthCm !== null ? length + ' · عرض ' + formatLength(item.widthCm) : length
}

/**
 * الموعد: المؤكد = «موعد التسليم: » + السطر · المفضّل = السطر + «موعد مفضل — بانتظار التأكيد» (زي الإيصال) · من غير موعد = null.
 */
export function trackDeliveryView(delivery: TrackedDelivery | null): { line: string; note: string | null } | null {
  if (delivery === null) return null
  const line = preferredDeliveryLine({ date: delivery.date, period: delivery.period, note: null })
  return delivery.kind === 'confirmed' ? { line: 'موعد التسليم: ' + line, note: null } : { line, note: PREFERRED_DELIVERY_PENDING }
}
