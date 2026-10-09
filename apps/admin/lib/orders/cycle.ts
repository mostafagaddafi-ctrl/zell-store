/**
 * 0021-A A2 — دورة الطلب في اللوحة: منطق خالص (من غير server-only ولا أي استيراد قيمة برّه المجلد)،
 * فحالات lib/orders/orders.cases.ts بتشغّله فعليًا في CI.
 *
 *   • الداتابيز هي المرجع (backend/db/migrations/0021a_a1_order_cycle.sql). الملف ده نسخة للعرض والتحقق المبدئي بس،
 *     وأي قرار نهائي (الانتقال · البوابة · الهوية · التعارض) بيتاخد جوه دوال zell_order_* .
 *   • الحالات وأسماؤها من @zell/core (أنواع بس هنا)؛ الواجهة بتمرّر الأسماء.
 *   • الوقت: العرض والإدخال بتوقيت القاهرة (Africa/Cairo)، والتخزين timestamptz.
 */
import type { OrderStatus } from '@zell/core'

// ── الانتقالات (نسخة من order_status_transitions بالحرف) ─────────────────────
export type TransitionGate = 'any' | 'open' | 'closed'

export const ORDER_TRANSITIONS: ReadonlyArray<{ from: OrderStatus; to: OrderStatus; gate: TransitionGate }> = [
  { from: 'new', to: 'confirmed', gate: 'any' },
  { from: 'new', to: 'cancelled', gate: 'any' },
  { from: 'confirmed', to: 'preparing', gate: 'open' },
  { from: 'confirmed', to: 'shipped', gate: 'closed' },
  { from: 'confirmed', to: 'cancelled', gate: 'any' },
  { from: 'preparing', to: 'shipped', gate: 'open' },
  { from: 'preparing', to: 'cancelled', gate: 'open' },
  { from: 'shipped', to: 'delivered', gate: 'any' },
  { from: 'shipped', to: 'refused', gate: 'open' },
]

/** الحالتين اللي ورا البوابة: بيظهروا في الأنواع والعرض، ومش متاحين كهدف طول ما البوابة مقفولة. */
export const GATED_STATUSES: readonly OrderStatus[] = ['preparing', 'refused']

/** الأهداف المسموحة من الحالة دي حسب البوابة (null = مش معروفة = مقفولة). */
export function allowedTargets(status: OrderStatus, gateOpen: boolean | null): OrderStatus[] {
  const open = gateOpen === true
  return ORDER_TRANSITIONS.filter(
    (t) => t.from === status && (t.gate === 'any' || (t.gate === 'open' && open) || (t.gate === 'closed' && !open)),
  ).map((t) => t.to)
}

export type StatusControls =
  | { kind: 'final'; message: string }
  | { kind: 'none'; message: string }
  | { kind: 'buttons'; targets: OrderStatus[] }

export const NO_TRANSITIONS_MESSAGE = 'مفيش انتقالات من الحالة دي.'

export function statusControls(status: OrderStatus, gateOpen: boolean | null, cancelledMessage: string): StatusControls {
  if (status === 'cancelled') return { kind: 'final', message: cancelledMessage }
  const targets = allowedTargets(status, gateOpen)
  if (targets.length === 0) return { kind: 'none', message: NO_TRANSITIONS_MESSAGE }
  return { kind: 'buttons', targets }
}

// ── المكالمة ─────────────────────────────────────────────────────────
export const CALL_OUTCOMES = [
  'no_answer',
  'busy',
  'wrong_number',
  'callback_later',
  'confirmed',
  'agreed_awaiting_deposit',
  'customer_cancelled',
] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  no_answer: 'مابيردش',
  busy: 'مشغول',
  wrong_number: 'رقم غلط',
  callback_later: 'يتكلم بعدين',
  confirmed: 'أكّد',
  agreed_awaiting_deposit: 'وافق — منتظر المقدم',
  customer_cancelled: 'لغى',
}

export const CALL_NOTE_MAX = 300
export const DELIVERY_NOTE_MAX = 200
export const INTERNAL_NOTE_MAX = 2000

export function isCallOutcome(value: unknown): value is CallOutcome {
  return typeof value === 'string' && (CALL_OUTCOMES as readonly string[]).includes(value)
}

/** المكالمة والمتابعة وتعديل البيانات في «جديد» بس (زي الداتابيز · 45410). */
export function callPanelOpen(status: OrderStatus): boolean {
  return status === 'new'
}

/** الموعد المؤكد مقفول بعد التسليم أو رفض الاستلام أو الإلغاء (45410). */
export function deliveryEditable(status: OrderStatus): boolean {
  return status !== 'delivered' && status !== 'refused' && status !== 'cancelled'
}

// ── الوقت بتوقيت القاهرة ───────────────────────────────────────────────
export const CAIRO_TZ = 'Africa/Cairo'
const DAY_MS = 24 * 60 * 60 * 1000

type WallParts = { y: number; m: number; d: number; h: number; mi: number }

function cairoParts(ms: number): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 'NaN')
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute') }
}

/** الفرق (القاهرة − UTC) بالمللي ثانية عند اللحظة دي. */
function cairoOffsetMs(ms: number): number {
  const p = cairoParts(ms)
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi)
  return wall - Math.floor(ms / 60000) * 60000
}

/** وقت حائط في القاهرة ← لحظة UTC (مللي ثانية). بيتظبط مرتين علشان تغيير التوقيت الصيفي. */
export function cairoWallToUtc(y: number, m: number, d: number, h: number, mi: number): number {
  const wall = Date.UTC(y, m - 1, d, h, mi)
  let guess = wall - cairoOffsetMs(wall)
  guess = wall - cairoOffsetMs(guess)
  return guess
}

/** بداية ونهاية يوم القاهرة اللي فيه اللحظة دي. */
export function cairoDayRange(nowMs: number): { start: number; end: number } {
  const p = cairoParts(nowMs)
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d) + DAY_MS)
  return {
    start: cairoWallToUtc(p.y, p.m, p.d, 0, 0),
    end: cairoWallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0),
  }
}

/** تاريخ النهارده في القاهرة YYYY-MM-DD. */
export function cairoToday(nowMs: number): string {
  const p = cairoParts(nowMs)
  return String(p.y).padStart(4, '0') + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0')
}

const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** قيمة datetime-local (وقت القاهرة) ← ISO UTC، أو null لو الشكل غلط. */
export function cairoInputToIso(value: string): string | null {
  const match = LOCAL_INPUT_RE.exec(value.trim())
  if (!match) return null
  const [y, m, d, h, mi] = match.slice(1).map(Number) as [number, number, number, number, number]
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return new Date(cairoWallToUtc(y, m, d, h, mi)).toISOString()
}

/** ISO ← قيمة datetime-local بوقت القاهرة (للقيمة الافتراضية في الفورم). */
export function isoToCairoInput(iso: string | null): string {
  if (iso === null) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const p = cairoParts(ms)
  return (
    String(p.y).padStart(4, '0') + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') +
    'T' + String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0')
  )
}

/** عرض تاريخ ووقت بتوقيت القاهرة. */
export function formatCairoDateTime(iso: string | null): string {
  if (iso === null) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Intl.DateTimeFormat('ar-EG', { timeZone: CAIRO_TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

// ── المتابعة ─────────────────────────────────────────────────────────
export const FOLLOW_UP_FILTERS = ['overdue', 'today', 'upcoming'] as const
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number]

export const FOLLOW_UP_FILTER_LABELS: Record<FollowUpFilter, string> = {
  overdue: 'متابعة متأخرة',
  today: 'متابعة النهارده',
  upcoming: 'متابعة جاية',
}

export function readFollowUpFilter(value: unknown): FollowUpFilter | null {
  return typeof value === 'string' && (FOLLOW_UP_FILTERS as readonly string[]).includes(value) ? (value as FollowUpFilter) : null
}

/**
 * التصنيف (من غير تداخل): متأخرة = الموعد عدّى · النهارده = من دلوقتي لآخر يوم القاهرة · جاية = بعد كده.
 * بيخص الطلبات اللي لسه «جديد» بس، زي الفلتر.
 */
export function followUpBucket(atIso: string | null, status: OrderStatus, nowMs: number): FollowUpFilter | null {
  if (atIso === null || status !== 'new') return null
  const at = Date.parse(atIso)
  if (!Number.isFinite(at)) return null
  if (at < nowMs) return 'overdue'
  return at < cairoDayRange(nowMs).end ? 'today' : 'upcoming'
}

/** أجزاء استعلام PostgREST لفلتر المتابعة (status = new دايمًا، والترتيب بالأقرب). */
export function followUpQueryParts(filter: FollowUpFilter, nowMs: number): string[] {
  const now = encodeURIComponent(new Date(nowMs).toISOString())
  const end = encodeURIComponent(new Date(cairoDayRange(nowMs).end).toISOString())
  const range =
    filter === 'overdue'
      ? ['next_follow_up_at=lt.' + now]
      : filter === 'today'
        ? ['next_follow_up_at=gte.' + now, 'next_follow_up_at=lt.' + end]
        : ['next_follow_up_at=gte.' + end]
  return ['status=eq.new', ...range, 'order=next_follow_up_at.asc,id.asc']
}

/** نفس حدود الداتابيز: مش أقدم من 5 دقايق، ومش أبعد من 366 يوم. */
export function followUpIssue(iso: string | null, nowMs: number): string | null {
  if (iso === null) return 'اختار معاد المتابعة (تاريخ ووقت).'
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return 'معاد المتابعة مش صالح.'
  if (at < nowMs - 5 * 60 * 1000) return 'معاد المتابعة لازم يكون في المستقبل.'
  if (at > nowMs + 366 * DAY_MS) return 'معاد المتابعة بعيد أوي (أكتر من سنة).'
  return null
}

/** تحقق فورم المكالمة قبل النداء. followUpIso بيتحسب من قيمة datetime-local بتوقيت القاهرة. */
export function callFormIssue(outcome: CallOutcome | null, followUpIso: string | null, note: string, nowMs: number): string | null {
  if (outcome === null) return 'اختار نتيجة المكالمة.'
  if (note.trim().length > CALL_NOTE_MAX) return 'الملاحظة أطول من ' + String(CALL_NOTE_MAX) + ' حرف.'
  if (outcome === 'callback_later') return followUpIssue(followUpIso, nowMs)
  return null
}

// ── الموعد المؤكد والفترات ──────────────────────────────────────────────
export const DELIVERY_PERIODS = ['morning', 'noon', 'evening'] as const
export type DeliveryPeriod = (typeof DELIVERY_PERIODS)[number]

export const DELIVERY_PERIOD_LABELS: Record<DeliveryPeriod, string> = {
  morning: 'الصبح',
  noon: 'الضهر',
  evening: 'بالليل',
}

export function isDeliveryPeriod(value: unknown): value is DeliveryPeriod {
  return typeof value === 'string' && (DELIVERY_PERIODS as readonly string[]).includes(value)
}

export type DeliveryInput = { date: string; period: string; note: string }
export type DeliveryValue = { date: string | null; period: DeliveryPeriod | null; note: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** نفس قواعد zell_order_set_confirmed_delivery: من غير تاريخ = مسح (ومفيش فترة ولا ملاحظة). */
export function deliveryValue(input: DeliveryInput): { ok: true; value: DeliveryValue } | { ok: false; message: string } {
  const date = input.date.trim()
  const note = input.note.trim()
  const period = input.period.trim()
  if (date === '') {
    if (period !== '' || note !== '') return { ok: false, message: 'اختار التاريخ الأول، أو امسح الفترة والملاحظة.' }
    return { ok: true, value: { date: null, period: null, note: null } }
  }
  if (!DATE_RE.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))) return { ok: false, message: 'التاريخ مش صالح.' }
  if (period !== '' && !isDeliveryPeriod(period)) return { ok: false, message: 'الفترة مش من التلاتة.' }
  if (note.length > DELIVERY_NOTE_MAX) return { ok: false, message: 'الملاحظة أطول من ' + String(DELIVERY_NOTE_MAX) + ' حرف.' }
  return { ok: true, value: { date, period: period === '' ? null : (period as DeliveryPeriod), note: note === '' ? null : note } }
}

export type PeriodRow = { period: DeliveryPeriod; startsAt: string; endsAt: string }
export type PeriodsView = { updatedAt: string; periods: PeriodRow[] }

export function parsePeriods(value: unknown): PeriodsView | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { updated_at?: unknown; periods?: unknown }
  if (typeof v.updated_at !== 'string' || !Array.isArray(v.periods)) return null
  const periods: PeriodRow[] = []
  for (const row of v.periods) {
    if (typeof row !== 'object' || row === null) return null
    const r = row as { period?: unknown; starts_at?: unknown; ends_at?: unknown }
    if (!isDeliveryPeriod(r.period) || typeof r.starts_at !== 'string' || typeof r.ends_at !== 'string') return null
    periods.push({ period: r.period, startsAt: r.starts_at, endsAt: r.ends_at })
  }
  return { updatedAt: v.updated_at, periods }
}

export function periodLine(row: PeriodRow): string {
  return DELIVERY_PERIOD_LABELS[row.period] + ' ' + row.startsAt + '–' + row.endsAt
}

// ── تعديل بيانات الزبون (نفس قواعد zell_order_edit_details) ─────────────────
export type DetailsInput = { customerName: string; customerPhone: string; address: string; notes: string }
export type DetailsCurrent = { customerName: string; customerPhone: string; address: string; notes: string | null; hasCoupon: boolean }
export type DetailsChanges = Partial<{ customer_name: string; customer_phone: string; address: string; notes: string | null }>

export const PHONE_RE = /^01[0125][0-9]{8}$/
export const PHONE_LOCKED_MESSAGE =
  'الطلب عليه كوبون مربوط برقم الموبايل، فالرقم مايتغيّرش. لو لازم يتغيّر: الغي الطلب واعمل طلب جديد.'
export const NO_CHANGES_MESSAGE = 'مفيش تغييرات تتحفظ.'

export function detailsChanges(input: DetailsInput, current: DetailsCurrent): { ok: true; changes: DetailsChanges } | { ok: false; message: string } {
  const changes: DetailsChanges = {}
  const name = input.customerName.trim()
  const address = input.address.trim()
  const notesText = input.notes.trim()
  const notes = notesText === '' ? null : notesText
  const phone = input.customerPhone.trim()
  if (name !== current.customerName) {
    if (name.length < 3 || name.length > 100) return { ok: false, message: 'الاسم لازم يكون من 3 لـ 100 حرف.' }
    changes.customer_name = name
  }
  if (address !== current.address) {
    if (address.length < 8 || address.length > 500) return { ok: false, message: 'العنوان لازم يكون من 8 لـ 500 حرف.' }
    changes.address = address
  }
  if (notes !== current.notes) {
    if (notesText.length > 500) return { ok: false, message: 'ملاحظات الزبون أطول من 500 حرف.' }
    changes.notes = notes
  }
  if (phone !== current.customerPhone) {
    if (current.hasCoupon) return { ok: false, message: PHONE_LOCKED_MESSAGE }
    if (!PHONE_RE.test(phone)) return { ok: false, message: 'رقم الموبايل لازم يكون 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015.' }
    changes.customer_phone = phone
  }
  if (Object.keys(changes).length === 0) return { ok: false, message: NO_CHANGES_MESSAGE }
  return { ok: true, changes }
}

// ── البوابة ونتيجة الكتابة ────────────────────────────────────────────
export type GateState = { isOpen: boolean; changedAt: string }

export function parseGateState(value: unknown): GateState | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { is_open?: unknown; changed_at?: unknown }
  if (typeof v.is_open !== 'boolean' || typeof v.changed_at !== 'string') return null
  return { isOpen: v.is_open, changedAt: v.changed_at }
}

export type OrderWriteResult = { orderId: number; status: string; updatedAt: string }

export function parseWriteResult(value: unknown): OrderWriteResult | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { ok?: unknown; order_id?: unknown; status?: unknown; updated_at?: unknown }
  if (v.ok !== true || typeof v.order_id !== 'number' || typeof v.status !== 'string' || typeof v.updated_at !== 'string') return null
  return { orderId: v.order_id, status: v.status, updatedAt: v.updated_at }
}

// ── سجل الأحداث ────────────────────────────────────────────────────────
export type OrderEvent = { id: number; kind: string; actor: string | null; createdAt: string; payload: Record<string, unknown> }

export function parseEvents(value: unknown): OrderEvent[] | null {
  if (!Array.isArray(value)) return null
  const out: OrderEvent[] = []
  for (const row of value) {
    if (typeof row !== 'object' || row === null) return null
    const r = row as { id?: unknown; kind?: unknown; actor?: unknown; created_at?: unknown; payload?: unknown }
    if (typeof r.id !== 'number' || typeof r.kind !== 'string' || typeof r.created_at !== 'string') return null
    if (r.actor !== null && typeof r.actor !== 'string') return null
    const payload = typeof r.payload === 'object' && r.payload !== null && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : {}
    out.push({ id: r.id, kind: r.kind, actor: r.actor ?? null, createdAt: r.created_at, payload })
  }
  return out
}

const FIELD_LABELS: Record<string, string> = {
  customer_name: 'الاسم',
  customer_phone: 'الموبايل',
  address: 'العنوان',
  notes: 'ملاحظات الزبون',
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

function quoted(value: unknown): string {
  const t = text(value)
  return t === null ? '(فاضي)' : '«' + t + '»'
}

export type EventLine = { title: string; detail: string | null }

/** وصف الحدث بالعربي. statusLabel بييجي من @zell/core (STATUS_LABELS) في الواجهة. */
export function describeEvent(event: OrderEvent, statusLabel: (status: string) => string): EventLine {
  const p = event.payload
  switch (event.kind) {
    case 'created':
      return { title: 'الطلب اتعمل', detail: null }
    case 'status_changed': {
      const reason = text(p['reason'])
      return {
        title: 'الحالة اتغيّرت من «' + statusLabel(String(p['from'] ?? '')) + '» لـ «' + statusLabel(String(p['to'] ?? '')) + '»',
        detail: reason === null ? null : reason === 'call' ? 'من نتيجة المكالمة' : reason,
      }
    }
    case 'call_attempt': {
      const outcome = p['outcome']
      return { title: 'مكالمة: ' + (isCallOutcome(outcome) ? CALL_OUTCOME_LABELS[outcome] : 'نتيجة غير معروفة'), detail: text(p['note']) }
    }
    case 'follow_up_set': {
      const next = text(p['new'])
      return {
        title: next === null ? 'معاد المتابعة اتشال' : 'معاد المتابعة: ' + formatCairoDateTime(next),
        detail: text(p['note']),
      }
    }
    case 'delivery_confirmed_set': {
      const next = typeof p['new'] === 'object' && p['new'] !== null ? (p['new'] as Record<string, unknown>) : {}
      const date = text(next['date'])
      const period = next['period']
      return {
        title:
          date === null
            ? 'معاد التسليم المؤكد اتشال'
            : 'معاد التسليم المؤكد: ' + date + (isDeliveryPeriod(period) ? ' · ' + DELIVERY_PERIOD_LABELS[period] : ''),
        detail: text(next['note']),
      }
    }
    case 'details_edited': {
      const field = String(p['field'] ?? '')
      return { title: 'اتعدّل ' + (FIELD_LABELS[field] ?? field), detail: 'من ' + quoted(p['old']) + ' لـ ' + quoted(p['new']) }
    }
    case 'note_changed':
      return { title: 'الملاحظات الداخلية اتعدّلت', detail: null }
    default:
      return { title: 'حدث: ' + event.kind, detail: null }
  }
}

/** الممثل: null = النظام (زي created من الـ trigger). غير كده أول 8 حروف من المعرّف. */
export function actorLabel(actor: string | null): string {
  return actor === null ? 'النظام' : 'أدمن ' + actor.slice(0, 8)
}

export const BEFORE_LOG_MESSAGE = 'الطلب ده قبل السجل — مفيش أحداث قديمة متسجّلة.'

// ── أخطاء دوال zell_order_* ─────────────────────────────────────────────
export type OrderFailureKind =
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'cancelled_final' }
  | { kind: 'validation'; message: string }
  | { kind: 'internal' }

const VALIDATION_BY_CODE: Record<string, string> = {
  '45402': 'العملية دي للمالك بس.',
  '45405': 'الانتقال ده مش مسموح من حالة الطلب الحالية. اعمل تحديث للصفحة.',
  '45406': 'الحالة دي لسه مش متاحة.',
  '45407': 'تغيير الحالة بقى من أزرار الطلب بس.',
  '45408': 'البيانات مش صالحة. راجعها وحاول تاني.',
  '45409': '«يتكلم بعدين» محتاجة معاد متابعة.',
  '45410': 'العملية دي مش متاحة في حالة الطلب الحالية. اعمل تحديث للصفحة.',
  '45411': PHONE_LOCKED_MESSAGE,
  '45412': 'الفترات مش صالحة.',
}

const SENTINEL_CODES: Record<string, string> = {
  ZELL_ORD_UNAUTHENTICATED: '45400',
  ZELL_ORD_FORBIDDEN: '45401',
  ZELL_ORD_OWNER_ONLY: '45402',
  ZELL_ORD_NOT_FOUND: '45403',
  ZELL_ORD_CONFLICT: '45404',
  ZELL_ORD_TRANSITION_NOT_ALLOWED: '45405',
  ZELL_ORD_GATE_CLOSED: '45406',
  ZELL_ORD_DIRECT_STATUS_LOCKED: '45407',
  ZELL_ORD_INVALID_INPUT: '45408',
  ZELL_ORD_FOLLOW_UP_REQUIRED: '45409',
  ZELL_ORD_NOT_ALLOWED_IN_STATUS: '45410',
  ZELL_ORD_PHONE_HAS_COUPON: '45411',
  ZELL_ORD_PERIODS_INVALID: '45412',
  ZELL_ORDER_CANCELLED_FINAL: '45080',
}

/** الكود من رد PostgREST: code (SQLSTATE) الأول، وبعدين اسم ZELL_* في message (الاسم كامل أو «الاسم:»). */
export function orderErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const e = error as { code?: unknown; message?: unknown }
  if (typeof e.code === 'string' && /^45\d{3}$/.test(e.code)) return e.code
  if (typeof e.message === 'string') {
    for (const [name, code] of Object.entries(SENTINEL_CODES)) {
      if (e.message === name || e.message.startsWith(name + ':')) return code
    }
  }
  return null
}

export function orderFailureKind(error: unknown, httpStatus: number): OrderFailureKind {
  const code = orderErrorCode(error)
  if (code === '45400') return { kind: 'unauthenticated' }
  if (code === '45401') return { kind: 'forbidden' }
  if (code === '45403') return { kind: 'not_found' }
  if (code === '45404') return { kind: 'conflict' }
  if (code === '45080') return { kind: 'cancelled_final' }
  if (code !== null && VALIDATION_BY_CODE[code] !== undefined) return { kind: 'validation', message: VALIDATION_BY_CODE[code] as string }
  if (httpStatus === 401) return { kind: 'unauthenticated' }
  return { kind: 'internal' }
}
