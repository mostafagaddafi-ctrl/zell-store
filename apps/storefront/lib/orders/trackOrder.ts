/**
 * TRACK-ORDER — «تتبّع طلبك»: تظبيط الكود اللي العميل كتبه · حارس شكل رد zell_checkout_track_order · نصوص العرض.
 *
 * العقود: docs/contracts/TRACK-ORDER.md §٣ و§٤ (v1) · docs/contracts/TRACK-ORDER-v2.md §٢ و§١٧-١ (v2، W2-A).
 * منطق خالص: من غير server-only ولا شبكة ولا متغيرات بيئة، علشان الحالات تتشغّل فعلًا في CI (suite track).
 *
 *   • التظبيط في السيرفر قبل أي نداء: شيل المسافات والشرط · حروف كبيرة · الطول ٦ = الستة · الطول ٩ وأوله FLM = آخر ٦ ·
 *     غير كده غلط · الستة لازم من أبجدية رقم الطلب. «FLM» مابيتشالش من الأول على طول، لأن الكود نفسه ممكن يبدأ بـ FLM.
 *   • أي إدخال غلط = مفيش نداء للداتابيز، ونفس رسالة «مش موجود».
 *   • الحارس بيبني كائن جديد من المفاتيح المعروفة بس، ومنها الكائنات المتداخلة بتاعة v2 — أي مفتاح زيادة في الرد
 *     مابيوصلش للمتصفح. أي شكل أو قيمة غير صالحة (ومنها مبالغ مش متسقة) = null، فالصفحة بتعرض «مش موجود».
 *   • من W2-A الرد لازم يكون v2 (W1 متطبّق على Production 2026-10-15). رجوع W1 لازم يسبقه revert W2-A (العقد §١٧-١).
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

export type TrackedCustomer = { name: string; phone: string; address: string; governorate: string; area: string | null }

export type TrackedHistoryEntry = { status: OrderStatus; at: string }

export type TrackedMoney = {
  itemsPiastres: number
  discountPiastres: number
  shippingPiastres: number
  installationPiastres: number
  travelPiastres: number
  totalPiastres: number
  confirmationFeePiastres: number
  paidPiastres: number
  refundedPiastres: number
  netPaidPiastres: number
  remainingPiastres: number
}

export type TrackedShippingMethod = 'standard' | 'express'

export type TrackedShipping = { method: TrackedShippingMethod; daysMin: number | null; daysMax: number | null }

export type TrackedConfirmedDelivery = { date: string; period: DeliveryPeriod | null }

export type TrackedShipment = {
  carrier: string
  trackingNumber: string | null
  trackingUrl: string | null
  shippedOn: string | null
  expectedOn: string | null
}

export type TrackedUpdate = { id: number; at: string; text: string; edited: boolean }

export type TrackedOrder = {
  orderNumber: string
  status: OrderStatus
  createdAt: string
  totalPiastres: number
  items: TrackedItem[]
  delivery: TrackedDelivery | null
  customer: TrackedCustomer
  history: TrackedHistoryEntry[]
  money: TrackedMoney
  shipping: TrackedShipping | null
  confirmedDelivery: TrackedConfirmedDelivery | null
  shipment: TrackedShipment | null
  updates: TrackedUpdate[]
}

export type TrackState =
  | { status: 'idle' }
  | { status: 'not_found'; message: string }
  | { status: 'found'; order: TrackedOrder; whatsappHref: string | null }

export const TRACK_INITIAL_STATE: TrackState = { status: 'idle' }

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isCount(value: unknown): value is number {
  return isInt(value) && value >= 0
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value))
}

function isCalendar(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value)
}

/** نص اختياري: null أو غايب = null · نص = نفسه · غير كده = undefined (رفض). */
function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : undefined
}

/** تاريخ اختياري YYYY-MM-DD: null أو غايب = null · تاريخ = نفسه · غير كده = undefined (رفض). */
function optionalCalendar(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  return isCalendar(value) ? value : undefined
}

function parseItems(raw: unknown): TrackedItem[] | null {
  if (!Array.isArray(raw)) return null
  const items: TrackedItem[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) return null
    const name = entry['product_name_ar']
    const unit = entry['sale_unit']
    const line = entry['line_total_piastres']
    const width = entry['width_cm']
    if (typeof name !== 'string' || !isCount(line)) return null
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
  return items
}

function parseDelivery(raw: unknown): TrackedDelivery | null | undefined {
  if (raw === null) return null
  if (!isPlainObject(raw)) return undefined
  const kind = raw['kind'] === 'confirmed' ? 'confirmed' : raw['kind'] === 'preferred' ? 'preferred' : null
  const date = raw['date']
  const period = raw['period']
  if (kind === null || !isCalendar(date)) return undefined
  if (period !== null && period !== undefined && !isDeliveryPeriod(period)) return undefined
  return { kind, date, period: isDeliveryPeriod(period) ? period : null }
}

function parseCustomer(raw: unknown): TrackedCustomer | null {
  if (!isPlainObject(raw)) return null
  const name = raw['name']
  const phone = raw['phone']
  const address = raw['address']
  const governorate = raw['governorate']
  const area = optionalText(raw['area'])
  if (typeof name !== 'string' || typeof phone !== 'string' || typeof address !== 'string' || typeof governorate !== 'string') return null
  if (area === undefined) return null
  return { name, phone, address, governorate, area: area === '' ? null : area }
}

function parseHistory(raw: unknown): TrackedHistoryEntry[] | null {
  if (!Array.isArray(raw)) return null
  const history: TrackedHistoryEntry[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) return null
    const status = entry['status']
    const at = entry['at']
    if (!isOrderStatus(status) || !isTimestamp(at)) return null
    history.push({ status, at })
  }
  return history
}

const MONEY_KEYS = [
  ['items_piastres', 'itemsPiastres'],
  ['discount_piastres', 'discountPiastres'],
  ['shipping_piastres', 'shippingPiastres'],
  ['installation_piastres', 'installationPiastres'],
  ['travel_piastres', 'travelPiastres'],
  ['total_piastres', 'totalPiastres'],
  ['confirmation_fee_piastres', 'confirmationFeePiastres'],
  ['paid_piastres', 'paidPiastres'],
  ['refunded_piastres', 'refundedPiastres'],
  ['net_paid_piastres', 'netPaidPiastres'],
  ['remaining_piastres', 'remainingPiastres'],
] as const

/** المبالغ الـ ١١ (العقد §٣)، وأي مبلغ مش متسق = null: الصافي = المدفوع − المردود، والمتبقي = الإجمالي − الصافي (≥ ٠). */
function parseMoney(raw: unknown, total: number): TrackedMoney | null {
  if (!isPlainObject(raw)) return null
  const out: Partial<Record<keyof TrackedMoney, number>> = {}
  for (const [from, to] of MONEY_KEYS) {
    const value = raw[from]
    if (!isCount(value)) return null
    out[to] = value
  }
  const money = out as TrackedMoney
  if (money.totalPiastres !== total) return null
  if (money.netPaidPiastres !== money.paidPiastres - money.refundedPiastres) return null
  if (money.remainingPiastres !== Math.max(money.totalPiastres - money.netPaidPiastres, 0)) return null
  return money
}

function parseShipping(raw: unknown): TrackedShipping | null | undefined {
  if (raw === null) return null
  if (!isPlainObject(raw)) return undefined
  const method = raw['method']
  const min = raw['days_min']
  const max = raw['days_max']
  if (method !== 'standard' && method !== 'express') return undefined
  if (min !== null && min !== undefined && !isCount(min)) return undefined
  if (max !== null && max !== undefined && !isCount(max)) return undefined
  const daysMin = isCount(min) ? min : null
  const daysMax = isCount(max) ? max : null
  if (daysMin !== null && daysMax !== null && daysMin > daysMax) return undefined
  return { method, daysMin, daysMax }
}

function parseConfirmedDelivery(raw: unknown): TrackedConfirmedDelivery | null | undefined {
  if (raw === null) return null
  if (!isPlainObject(raw)) return undefined
  const date = raw['date']
  const period = raw['period']
  if (!isCalendar(date)) return undefined
  if (period !== null && period !== undefined && !isDeliveryPeriod(period)) return undefined
  return { date, period: isDeliveryPeriod(period) ? period : null }
}

function parseShipment(raw: unknown): TrackedShipment | null | undefined {
  if (raw === null) return null
  if (!isPlainObject(raw)) return undefined
  const carrier = raw['carrier']
  const trackingNumber = optionalText(raw['tracking_number'])
  const trackingUrl = optionalText(raw['tracking_url'])
  const shippedOn = optionalCalendar(raw['shipped_on'])
  const expectedOn = optionalCalendar(raw['expected_on'])
  if (typeof carrier !== 'string' || carrier.trim() === '' || carrier.length > 60) return undefined
  if (trackingNumber === undefined || trackingUrl === undefined || shippedOn === undefined || expectedOn === undefined) return undefined
  if (trackingNumber !== null && trackingNumber.length > 60) return undefined
  if (trackingUrl !== null && (!trackingUrl.startsWith('https://') || trackingUrl.length > 300 || /\s/.test(trackingUrl))) return undefined
  return {
    carrier,
    trackingNumber: trackingNumber === '' ? null : trackingNumber,
    trackingUrl,
    shippedOn,
    expectedOn,
  }
}

function parseUpdates(raw: unknown): TrackedUpdate[] | null {
  if (!Array.isArray(raw)) return null
  const updates: TrackedUpdate[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) return null
    const id = entry['id']
    const at = entry['at']
    const text = entry['text']
    const edited = entry['edited']
    if (!isInt(id) || id <= 0 || !isTimestamp(at) || typeof edited !== 'boolean') return null
    if (typeof text !== 'string' || text.trim() === '' || text.length > 300) return null
    updates.push({ id, at, text, edited })
  }
  return updates
}

/**
 * حارس كامل لرد zell_checkout_track_order (v1 §٢ + v2 §٢-٢). أي شكل غير متوقع = null، فالصفحة بتعرض نفس رسالة «مش موجود»
 * من غير ما تقع. بيرجّع كائن جديد بالمفاتيح المعروفة بس، ومفيش أي جزء من الرد بيتمرّر زي ما هو.
 */
export function parseTrackedOrder(value: unknown): TrackedOrder | null {
  if (!isPlainObject(value)) return null
  const orderNumber = value['order_number']
  const status = value['status']
  const createdAt = value['created_at']
  const total = value['total_piastres']
  if (typeof orderNumber !== 'string' || !ORDER_NUMBER_RE.test(orderNumber)) return null
  if (!isOrderStatus(status)) return null
  if (!isTimestamp(createdAt)) return null
  if (!isCount(total)) return null

  const items = parseItems(value['items'])
  if (items === null) return null

  for (const key of ['delivery', 'shipping', 'confirmed_delivery', 'shipment']) {
    if (!(key in value)) return null
  }
  const delivery = parseDelivery(value['delivery'])
  const customer = parseCustomer(value['customer'])
  const history = parseHistory(value['history'])
  const money = parseMoney(value['money'], total)
  const shipping = parseShipping(value['shipping'])
  const confirmedDelivery = parseConfirmedDelivery(value['confirmed_delivery'])
  const shipment = parseShipment(value['shipment'])
  const updates = parseUpdates(value['updates'])
  if (delivery === undefined || shipping === undefined || confirmedDelivery === undefined || shipment === undefined) return null
  if (customer === null || history === null || money === null || updates === null) return null

  return { orderNumber, status, createdAt, totalPiastres: total, items, delivery, customer, history, money, shipping, confirmedDelivery, shipment, updates }
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
 * الموعد زي v1: المؤكد = «موعد التسليم: » + السطر · المفضّل = السطر + «موعد مفضل — بانتظار التأكيد» (زي الإيصال) · من غير موعد = null.
 */
export function trackDeliveryView(delivery: TrackedDelivery | null): { line: string; note: string | null } | null {
  if (delivery === null) return null
  const line = preferredDeliveryLine({ date: delivery.date, period: delivery.period, note: null })
  return delivery.kind === 'confirmed' ? { line: 'موعد التسليم: ' + line, note: null } : { line, note: PREFERRED_DELIVERY_PENDING }
}
