import type { OrderStatus } from '@zell/core'
import { ADMIN_STATUS_LABELS, cairoToday, orderErrorCode, orderFailureKind, type OrderFailureKind } from './cycle'

/**
 * TRACK-ORDER v2 W2-B — كارت «بيانات الشحنة» وكارت «رسائل للعميل» في صفحة الطلب (العقد docs/contracts/TRACK-ORDER-v2.md
 * §٥ · §٦ · §١٦ · §١٧-٢). منطق خالص (من غير server-only ولا أي استيراد قيمة برّه المجلد)، فحالات suite track-updates بتشغّله فعليًا.
 *
 * القراية والكتابة بجلسة المستخدم (zell_shipment_* و zell_customer_update_*)، والقرار النهائي في الداتابيز: الهوية · الطلب أو
 * الرسالة (45403) · النسخة (45404) · الحالة (45410) · التحقق بالحقل في detail (45433 الشحنة · 45434 الرسايل).
 * التحقق هنا نفس قواعد الداتابيز بالحرف علشان رسالة أوضح قبل النداء. النصوص الظاهرة رسمية (فصحى مبسّطة).
 */

/** نفس حدود الداتابيز (zell_shipment_save · zell_customer_update_text · zell_customer_update_add). */
export const CARRIER_MAX = 60
export const TRACKING_NUMBER_MAX = 60
export const TRACKING_URL_MAX = 300
export const EXPECTED_DAYS_AHEAD = 366
export const UPDATE_TEXT_MAX = 300
export const UPDATES_MAX = 50

/** نفس regex الداتابيز بالحرف. */
export const TRACKING_URL_RE = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][!-~]*)?$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
/** [[:cntrl:]] في الداتابيز: C0 و DEL و C1. */
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/
const DAY_MS = 24 * 60 * 60 * 1000

// ── النصوص ─────────────────────────────────────────────────────────────
export const SHIPMENT_TEXT = {
  title: 'بيانات الشحنة',
  intro: 'تظهر هذه البيانات للعميل في صفحة «تتبّع طلبك». حفظها لا يغيّر حالة الطلب، وتغيير الحالة لا يحفظ بيانات شحنة.',
  none: 'لم تُسجَّل بيانات شحنة لهذا الطلب بعد.',
  carrier: 'شركة الشحن',
  trackingNumber: 'رقم الشحنة (اختياري)',
  trackingUrl: 'رابط تتبّع الشحنة (اختياري)',
  trackingUrlHint: 'يجب أن يبدأ بـ https://',
  shippedOn: 'تاريخ الشحن (اختياري)',
  expectedOn: 'تاريخ الوصول المتوقع (اختياري)',
  expectedHint: 'إذا تُرك فارغًا يُحسب الموعد المتوقع للعميل من تاريخ الشحن ومدة الشحن المحفوظة في الطلب.',
  noDelete: 'لا يمكن حذف بيانات الشحنة بعد حفظها، ويمكن تعديلها في أي وقت.',
  locked: 'يُتاح حفظ بيانات الشحنة بعد تأكيد الطلب، ولا يُتاح للطلب الجديد أو الملغى أو المرفوض.',
  lastUpdated: 'آخر تحديث: ',
  openLink: 'فتح رابط التتبّع',
  save: 'حفظ بيانات الشحنة',
  saving: 'جارٍ الحفظ…',
  saved: 'تم حفظ بيانات الشحنة.',
  unchanged: 'لا توجد تغييرات للحفظ.',
  unavailable: 'بيانات الشحنة غير متاحة حاليًا.',
} as const

export const UPDATES_TEXT = {
  title: 'رسائل للعميل',
  intro:
    'تظهر الرسائل غير المخفية للعميل في صفحة «تتبّع طلبك» مع وقت إضافتها، ويظهر بجانب الرسالة المعدّلة أنها عُدّلت. لا تكتب هنا أي ملاحظات داخلية.',
  empty: 'لا توجد رسائل لهذا الطلب.',
  newLabel: 'رسالة جديدة',
  add: 'إضافة الرسالة',
  added: 'تمت إضافة الرسالة.',
  edit: 'تعديل',
  cancel: 'إلغاء',
  saveEdit: 'حفظ التعديل',
  editSaved: 'تم حفظ التعديل.',
  unchanged: 'لا توجد تغييرات للحفظ.',
  hide: 'إخفاء عن العميل',
  show: 'إظهار للعميل',
  hiddenDone: 'تم إخفاء الرسالة عن العميل.',
  shownDone: 'أصبحت الرسالة ظاهرة للعميل.',
  hiddenBadge: 'مخفية عن العميل',
  editedBadge: 'معدّلة',
  hideConfirm: 'ستختفي هذه الرسالة من صفحة «تتبّع طلبك» لدى العميل. هل تريد المتابعة؟',
  addedAt: 'أُضيفت: ',
  limitReached: 'بلغ الطلب الحد الأقصى للرسائل (50 رسالة شاملة المخفية). يمكنك تعديل رسالة قائمة بدلًا من الإضافة.',
  unavailable: 'رسائل العميل غير متاحة حاليًا.',
} as const

export function updatesCountLine(count: number): string {
  return 'عدد الرسائل: ' + String(count) + ' من ' + String(UPDATES_MAX) + ' (شاملة المخفية).'
}

export function charsLine(text: string): string {
  return String(charCount(text)) + ' / ' + String(UPDATE_TEXT_MAX)
}

export type ShipmentField = 'carrier' | 'tracking_number' | 'tracking_url' | 'shipped_on' | 'expected_on'
export type UpdateField = 'text' | 'hidden' | 'count'

export const SHIPMENT_FIELD_MESSAGES: Readonly<Record<ShipmentField, string>> = {
  carrier: 'اسم شركة الشحن مطلوب، بحد أقصى 60 حرفًا ومن دون رموز تحكم.',
  tracking_number: 'رقم الشحنة اختياري، بحد أقصى 60 حرفًا ومن دون رموز تحكم.',
  tracking_url: 'رابط التتبّع اختياري، ويجب أن يبدأ بـ https:// وأن يتضمن نطاقًا صحيحًا من دون مسافات، بحد أقصى 300 حرف.',
  shipped_on: 'تاريخ الشحن اختياري، ويجب أن يكون بين تاريخ الطلب واليوم (بتوقيت القاهرة).',
  expected_on: 'تاريخ الوصول المتوقع اختياري، ويجب أن يكون بين تاريخ الطلب وسنة من اليوم، وألا يسبق تاريخ الشحن.',
}

export const UPDATE_FIELD_MESSAGES: Readonly<Record<UpdateField, string>> = {
  text: 'نص الرسالة مطلوب، بحد أقصى 300 حرف ومن دون رموز تحكم.',
  hidden: 'حالة الإظهار غير صالحة. حدّث الصفحة وحاول مرة أخرى.',
  count: UPDATES_TEXT.limitReached,
}

export const SHIPMENT_INVALID_MESSAGE = 'بيانات الشحنة غير صالحة. راجعها وحاول مرة أخرى.'
export const SHIPMENT_STATUS_MESSAGE = 'لا يمكن حفظ بيانات الشحنة في حالة الطلب الحالية. ' + SHIPMENT_TEXT.locked
export const UPDATE_NOT_FOUND_MESSAGE = 'الطلب أو الرسالة غير موجودة. حدّث الصفحة وحاول مرة أخرى.'
/** 45404: الكارت بيعيد القراية تلقائيًا ومابيمسحش اللي اتكتب، ومفيش إعادة إرسال تلقائية. */
export const TRACK_CONFLICT_MESSAGE =
  'تغيّرت هذه البيانات من مكان آخر، وجرى تحميل أحدث نسخة مع الاحتفاظ بما كتبته ولم يُحفظ. راجعها ثم أعد الحفظ إن لزم.'
export const ORDER_NUMBER_MESSAGE = 'رقم الطلب غير صالح. حدّث الصفحة وحاول مرة أخرى.'
export const STAMP_MESSAGE = 'طابع آخر تعديل غير صالح. حدّث الصفحة وحاول مرة أخرى.'
export const LAST_ID_MESSAGE = 'نسخة قائمة الرسائل غير صالحة. حدّث الصفحة وحاول مرة أخرى.'
export const UPDATE_ID_MESSAGE = 'معرّف الرسالة غير صالح. حدّث الصفحة وحاول مرة أخرى.'

// ── أدوات ──────────────────────────────────────────────────────────────
function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** btrim(..., E' \t\r\n') زي الداتابيز (مش trim بتاع JS اللي بيشيل مسافات تانية). */
export function dbTrim(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
}

/** عدد الحروف بالـ code points زي char_length. */
export function charCount(value: string): number {
  return Array.from(value).length
}

export function isCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value)
  if (!match) return false
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** يوم (YYYY-MM-DD) + عدد أيام. */
export function addDays(day: string, days: number): string {
  const match = DATE_RE.exec(day)
  if (!match) return day
  const t = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * DAY_MS)
  return String(t.getUTCFullYear()).padStart(4, '0') + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0')
}

function isStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ADMIN_STATUS_LABELS, value)
}

export function isUpdateId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function isStamp(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value))
}

export function isOrderNumber(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= 64 && value === value.trim()
}

function optText(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && value !== '' ? value : undefined
}

function optDate(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && isCalendarDate(value) ? value : undefined
}

// ── الشحنة ─────────────────────────────────────────────────────────────
export type Shipment = {
  carrier: string
  trackingNumber: string | null
  trackingUrl: string | null
  shippedOn: string | null
  expectedOn: string | null
  updatedAt: string
}

export type ShipmentView = { orderNumber: string; status: OrderStatus; editable: boolean; shipment: Shipment | null }

/** رد zell_shipment_get أو _save. أي شكل تاني = null («غير متاح»). */
export function parseShipmentView(raw: unknown): ShipmentView | null {
  if (!isObj(raw)) return null
  const orderNumber = raw['order_number']
  const status = raw['status']
  const editable = raw['editable']
  if (!isOrderNumber(orderNumber) || !isStatus(status) || typeof editable !== 'boolean') return null
  const s = raw['shipment']
  if (s === null) return { orderNumber, status, editable, shipment: null }
  if (!isObj(s)) return null
  const carrier = s['carrier']
  const trackingNumber = optText(s['tracking_number'])
  const trackingUrl = optText(s['tracking_url'])
  const shippedOn = optDate(s['shipped_on'])
  const expectedOn = optDate(s['expected_on'])
  const updatedAt = s['updated_at']
  if (typeof carrier !== 'string' || carrier === '' || trackingNumber === undefined || trackingUrl === undefined) return null
  if (shippedOn === undefined || expectedOn === undefined || !isStamp(updatedAt)) return null
  return { orderNumber, status, editable, shipment: { carrier, trackingNumber, trackingUrl, shippedOn, expectedOn, updatedAt } }
}

/** رد zell_shipment_save: النتيجة (بشحنة) + changed. */
export function parseShipmentSaved(raw: unknown): { view: ShipmentView; changed: boolean } | null {
  const view = parseShipmentView(raw)
  if (view === null || view.shipment === null || !isObj(raw) || typeof raw['changed'] !== 'boolean') return null
  return { view, changed: raw['changed'] }
}

export type ShipmentForm = { carrier: string; trackingNumber: string; trackingUrl: string; shippedOn: string; expectedOn: string }

export type ShipmentPayload = {
  carrier: string
  trackingNumber: string | null
  trackingUrl: string | null
  shippedOn: string | null
  expectedOn: string | null
}

/** حدود التواريخ بتوقيت القاهرة: يوم الطلب والنهارده. */
export type ShipmentBounds = { orderDay: string; today: string }

export function shipmentBounds(orderCreatedAt: string, nowMs: number): ShipmentBounds | null {
  const created = Date.parse(orderCreatedAt)
  if (!Number.isFinite(created) || !Number.isFinite(nowMs)) return null
  return { orderDay: cairoToday(created), today: cairoToday(nowMs) }
}

export function expectedMax(bounds: ShipmentBounds): string {
  return addDays(bounds.today, EXPECTED_DAYS_AHEAD)
}

export function shipmentFormOf(view: ShipmentView | null): ShipmentForm {
  const s = view === null ? null : view.shipment
  return {
    carrier: s?.carrier ?? '',
    trackingNumber: s?.trackingNumber ?? '',
    trackingUrl: s?.trackingUrl ?? '',
    shippedOn: s?.shippedOn ?? '',
    expectedOn: s?.expectedOn ?? '',
  }
}

export type ShipmentCheck = { ok: true; value: ShipmentPayload } | { ok: false; field: ShipmentField; message: string }

function shipmentFail(field: ShipmentField): ShipmentCheck {
  return { ok: false, field, message: SHIPMENT_FIELD_MESSAGES[field] }
}

/**
 * الفورم ← قيم النداء بنفس قواعد الداتابيز وترتيبها. bounds = null (السيرفر) = الشكل بس، وحدود التواريخ في الداتابيز (45433).
 */
export function shipmentPayload(form: ShipmentForm, bounds: ShipmentBounds | null): ShipmentCheck {
  if (!isObj(form)) return shipmentFail('carrier')
  const f = form as Record<string, unknown>
  const text = (key: string): string | null => (typeof f[key] === 'string' ? (f[key] as string) : null)
  const rawCarrier = text('carrier')
  const rawNumber = text('trackingNumber')
  const rawUrl = text('trackingUrl')
  const rawShipped = text('shippedOn')
  const rawExpected = text('expectedOn')

  if (rawCarrier === null) return shipmentFail('carrier')
  const carrier = dbTrim(rawCarrier.normalize('NFC'))
  if (carrier === '' || charCount(carrier) > CARRIER_MAX || CONTROL_RE.test(carrier)) return shipmentFail('carrier')

  if (rawNumber === null) return shipmentFail('tracking_number')
  const numberText = dbTrim(rawNumber.normalize('NFC'))
  const trackingNumber = numberText === '' ? null : numberText
  if (trackingNumber !== null && (charCount(trackingNumber) > TRACKING_NUMBER_MAX || CONTROL_RE.test(trackingNumber))) {
    return shipmentFail('tracking_number')
  }

  if (rawUrl === null) return shipmentFail('tracking_url')
  const urlText = dbTrim(rawUrl)
  const trackingUrl = urlText === '' ? null : urlText
  if (trackingUrl !== null && (charCount(trackingUrl) > TRACKING_URL_MAX || !TRACKING_URL_RE.test(trackingUrl))) {
    return shipmentFail('tracking_url')
  }

  if (rawShipped === null) return shipmentFail('shipped_on')
  const shippedText = rawShipped.trim()
  const shippedOn = shippedText === '' ? null : shippedText
  if (shippedOn !== null) {
    if (!isCalendarDate(shippedOn)) return shipmentFail('shipped_on')
    if (bounds !== null && (shippedOn < bounds.orderDay || shippedOn > bounds.today)) return shipmentFail('shipped_on')
  }

  if (rawExpected === null) return shipmentFail('expected_on')
  const expectedText = rawExpected.trim()
  const expectedOn = expectedText === '' ? null : expectedText
  if (expectedOn !== null) {
    if (!isCalendarDate(expectedOn)) return shipmentFail('expected_on')
    if (bounds !== null && (expectedOn < bounds.orderDay || expectedOn > expectedMax(bounds))) return shipmentFail('expected_on')
    if (shippedOn !== null && expectedOn < shippedOn) return shipmentFail('expected_on')
  }

  return { ok: true, value: { carrier, trackingNumber, trackingUrl, shippedOn, expectedOn } }
}

// ── رسائل العميل ───────────────────────────────────────────────────────
export type CustomerUpdate = { id: number; text: string; hidden: boolean; edited: boolean; createdAt: string; updatedAt: string }

export type UpdatesView = { orderNumber: string; status: OrderStatus; lastId: number | null; updates: CustomerUpdate[] }

/** رد zell_customer_update_list أو _add / _edit / _set_hidden. last_id لازم = أكبر id (أو null من غير رسايل). */
export function parseUpdatesView(raw: unknown): UpdatesView | null {
  if (!isObj(raw)) return null
  const orderNumber = raw['order_number']
  const status = raw['status']
  const lastId = raw['last_id']
  const list = raw['updates']
  if (!isOrderNumber(orderNumber) || !isStatus(status) || !Array.isArray(list)) return null
  const updates: CustomerUpdate[] = []
  const seen = new Set<number>()
  for (const item of list) {
    if (!isObj(item)) return null
    const id = item['id']
    const text = item['text']
    const hidden = item['hidden']
    const edited = item['edited']
    const createdAt = item['created_at']
    const updatedAt = item['updated_at']
    if (!isUpdateId(id) || seen.has(id) || typeof text !== 'string' || text === '') return null
    if (typeof hidden !== 'boolean' || typeof edited !== 'boolean' || !isStamp(createdAt) || !isStamp(updatedAt)) return null
    seen.add(id)
    updates.push({ id, text, hidden, edited, createdAt, updatedAt })
  }
  const maxId = updates.reduce<number | null>((max, u) => (max === null || u.id > max ? u.id : max), null)
  if (maxId === null ? lastId !== null : lastId !== maxId) return null
  return { orderNumber, status, lastId: maxId, updates }
}

/** رد الإضافة أو التعديل أو الإخفاء: القايمة + id (موجود فيها) + changed. */
export function parseUpdatesWritten(raw: unknown): { view: UpdatesView; id: number; changed: boolean } | null {
  const view = parseUpdatesView(raw)
  if (view === null || !isObj(raw)) return null
  const id = raw['id']
  const changed = raw['changed']
  if (!isUpdateId(id) || typeof changed !== 'boolean' || !view.updates.some((u) => u.id === id)) return null
  return { view, id, changed }
}

/** النص: NFC · CRLF ← LF · trim · 1..300 · مفيش control characters غير السطر الجديد (زي zell_customer_update_text). */
export function updateText(value: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: UPDATE_FIELD_MESSAGES.text }
  const text = dbTrim(value.normalize('NFC').replace(/\r\n/g, '\n'))
  if (text === '' || charCount(text) > UPDATE_TEXT_MAX || CONTROL_RE.test(text.replace(/\n/g, ''))) {
    return { ok: false, message: UPDATE_FIELD_MESSAGES.text }
  }
  return { ok: true, value: text }
}

export function canAddUpdate(view: UpdatesView): boolean {
  return view.updates.length < UPDATES_MAX
}

// ── أخطاء الدوال ───────────────────────────────────────────────────────
function detailOf(error: unknown): string | null {
  return isObj(error) && typeof error['details'] === 'string' ? error['details'] : null
}

/** 45433 بالحقل · 45410 الحالة · غير كده نفس تصنيف zell_order_* (45400 · 45401 · 45403 · 45404 …). */
export function shipmentFailureKind(error: unknown, httpStatus: number): OrderFailureKind {
  const code = orderErrorCode(error)
  if (code === '45433') {
    const detail = detailOf(error)
    const message = detail !== null && Object.prototype.hasOwnProperty.call(SHIPMENT_FIELD_MESSAGES, detail)
      ? SHIPMENT_FIELD_MESSAGES[detail as ShipmentField]
      : SHIPMENT_INVALID_MESSAGE
    return { kind: 'validation', message }
  }
  if (code === '45410') return { kind: 'validation', message: SHIPMENT_STATUS_MESSAGE }
  return orderFailureKind(error, httpStatus)
}

/** 45434 بالحقل (text · hidden · count) · غير كده نفس تصنيف zell_order_*. */
export function updateFailureKind(error: unknown, httpStatus: number): OrderFailureKind {
  if (orderErrorCode(error) === '45434') {
    const detail = detailOf(error)
    const message = detail !== null && Object.prototype.hasOwnProperty.call(UPDATE_FIELD_MESSAGES, detail)
      ? UPDATE_FIELD_MESSAGES[detail as UpdateField]
      : UPDATE_FIELD_MESSAGES.text
    return { kind: 'validation', message }
  }
  return orderFailureKind(error, httpStatus)
}

/** نتيجة أي كتابة للكارتين: changed = false لما القيم زي ما هي (مفيش كتابة ولا سطر سجل). */
export type TrackWriteOutcome = { changed: boolean }
