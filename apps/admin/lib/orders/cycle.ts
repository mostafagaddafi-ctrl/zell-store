/**
 * 0021-A A2 — دورة الطلب في اللوحة: منطق خالص (من غير server-only ولا أي استيراد قيمة برّه المجلد)،
 * فحالات lib/orders/orders.cases.ts بتشغّله فعليًا في CI.
 *
 *   • الداتابيز هي المرجع (backend/db/migrations/0021a_a1_order_cycle.sql). الملف ده نسخة للعرض والتحقق المبدئي بس،
 *     وأي قرار نهائي (الانتقال · البوابة · الهوية · التعارض) بيتاخد جوه دوال zell_order_* .
 *   • النصوص الظاهرة في لوحة الطلبات كلها من هنا (تحسين النصوص بعد A2). القيم الداخلية زي ما هي.
 *     أسماء الحالات هنا للوحة بس؛ @zell/core فاضل زي ما هو (المتجر والإيصال مابيعرضوش الحالة).
 *   • الوقت: العرض والإدخال بتوقيت القاهرة (Africa/Cairo)، والتخزين timestamptz.
 */
import type { OrderStatus } from '@zell/core'

// ── أسماء الحالات في لوحة الإدارة ─────────────────────────────────────────
export const ADMIN_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  new: 'طلب جديد',
  confirmed: 'تم التأكيد',
  preparing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  refused: 'رفض الاستلام',
  cancelled: 'ملغى',
}

export const CANCELLED_FINAL_MESSAGE = 'هذا الطلب ملغى، والإلغاء نهائي ولا يمكن إعادته لأي حالة أخرى.'

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

/** نص زرار الانتقال: فعل واضح حسب الحالة الهدف. */
export const TRANSITION_ACTION_LABELS: Readonly<Record<OrderStatus, string>> = {
  new: 'إرجاع إلى طلب جديد',
  confirmed: 'تأكيد الطلب',
  preparing: 'بدء التجهيز',
  shipped: 'تسجيل الشحن',
  delivered: 'تسجيل التسليم',
  refused: 'تسجيل رفض الاستلام',
  cancelled: 'إلغاء الطلب',
}

/** تأكيد قبل العمليات النهائية أو الخطرة (null = من غير تأكيد). */
export function transitionConfirmation(target: OrderStatus): string | null {
  if (target === 'cancelled') return 'هل تريد إلغاء الطلب؟ الإلغاء نهائي ولا يمكن التراجع عنه.'
  if (target === 'delivered') return 'هل تريد تسجيل تسليم الطلب؟ هذه حالة نهائية.'
  if (target === 'refused') return 'هل تريد تسجيل رفض العميل استلام الطلب؟ هذه حالة نهائية.'
  return null
}

export const TRANSITION_SAVED_MESSAGE = 'تم تغيير حالة الطلب.'

export function transitionBusyMessage(target: OrderStatus): string {
  return 'جارٍ التنفيذ: ' + TRANSITION_ACTION_LABELS[target] + '…'
}

export type StatusControls =
  | { kind: 'final'; message: string }
  | { kind: 'none'; message: string }
  | { kind: 'buttons'; targets: OrderStatus[] }

export const NO_TRANSITIONS_MESSAGE = 'لا توجد إجراءات متاحة على حالة هذا الطلب.'

export function statusControls(status: OrderStatus, gateOpen: boolean | null, cancelledMessage: string): StatusControls {
  if (status === 'cancelled') return { kind: 'final', message: cancelledMessage }
  const targets = allowedTargets(status, gateOpen)
  if (targets.length === 0) return { kind: 'none', message: NO_TRANSITIONS_MESSAGE }
  return { kind: 'buttons', targets }
}

// ── التواصل مع العميل ─────────────────────────────────────────────────
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
  no_answer: 'لا يجيب',
  busy: 'الخط مشغول',
  wrong_number: 'رقم غير صحيح',
  callback_later: 'متابعة لاحقًا',
  confirmed: 'تم تأكيد الطلب',
  agreed_awaiting_deposit: 'وافق — بانتظار الدفعة المقدمة',
  customer_cancelled: 'ألغى الطلب',
}

export const CALL_TEXT = {
  title: 'نتيجة التواصل',
  outcomeLabel: 'نتيجة التواصل',
  noteLabel: 'ملاحظة التواصل (اختياري)',
  followUpLabel: 'موعد المتابعة (بتوقيت القاهرة)',
  followUpHint: 'التاريخ والوقت إجباريان مع «متابعة لاحقًا».',
  submit: 'حفظ نتيجة التواصل',
  saving: 'جارٍ الحفظ…',
  saved: 'تم حفظ نتيجة التواصل.',
  confirmedHint: '«تم تأكيد الطلب» ينقل الطلب إلى حالة «تم التأكيد».',
  cancelledHint: '«ألغى الطلب» يلغي الطلب، والإلغاء نهائي.',
  cancelledConfirm: 'هل تريد تسجيل أن العميل ألغى الطلب؟ سيتم إلغاء الطلب نهائيًا.',
} as const

export const CALL_NOTE_MAX = 300
export const DELIVERY_NOTE_MAX = 200
export const INTERNAL_NOTE_MAX = 2000

export function isCallOutcome(value: unknown): value is CallOutcome {
  return typeof value === 'string' && (CALL_OUTCOMES as readonly string[]).includes(value)
}

/** التواصل والمتابعة وتعديل البيانات في «طلب جديد» بس (زي الداتابيز · 45410). */
export function callPanelOpen(status: OrderStatus): boolean {
  return status === 'new'
}

/** موعد التسليم مقفول بعد التسليم أو رفض الاستلام أو الإلغاء (45410). */
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

/** عرض تاريخ ووقت بوضوح بتوقيت القاهرة (مع اسم المنطقة). */
export function formatCairoDateTime(iso: string | null): string {
  if (iso === null) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return (
    new Intl.DateTimeFormat('ar-EG', {
      timeZone: CAIRO_TZ,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms)) + ' (بتوقيت القاهرة)'
  )
}

/** صيغة قصيرة لعلامات القايمة (اليوم والشهر والوقت) بتوقيت القاهرة. */
export function formatCairoShort(iso: string | null): string {
  if (iso === null) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Intl.DateTimeFormat('ar-EG', { timeZone: CAIRO_TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
}

// ── موعد المتابعة ─────────────────────────────────────────────────────
export const FOLLOW_UP_FILTERS = ['overdue', 'today', 'upcoming'] as const
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number]

export const FOLLOW_UP_FILTER_LABELS: Record<FollowUpFilter, string> = {
  overdue: 'متابعة متأخرة',
  today: 'متابعة اليوم',
  upcoming: 'متابعة قادمة',
}

export const FOLLOW_UP_TEXT = {
  title: 'موعد المتابعة',
  none: 'لا يوجد موعد متابعة.',
  inputLabel: 'موعد المتابعة (بتوقيت القاهرة)',
  noteLabel: 'ملاحظة (اختياري)',
  save: 'تحديد موعد المتابعة',
  clear: 'إلغاء موعد المتابعة',
  clearConfirm: 'هل تريد إلغاء موعد المتابعة؟ سيظل الموعد السابق ظاهرًا في سجل الطلب.',
  saved: 'تم تحديد موعد المتابعة.',
  cleared: 'تم إلغاء موعد المتابعة.',
  onlyNew: 'المتابعة متاحة للطلبات الجديدة فقط.',
  missing: 'حدد موعد المتابعة أولًا.',
} as const

export function readFollowUpFilter(value: unknown): FollowUpFilter | null {
  return typeof value === 'string' && (FOLLOW_UP_FILTERS as readonly string[]).includes(value) ? (value as FollowUpFilter) : null
}

/**
 * التصنيف (من غير تداخل): متأخرة = الموعد عدّى · اليوم = من دلوقتي لآخر يوم القاهرة · قادمة = بعد كده.
 * بيخص الطلبات اللي لسه «طلب جديد» بس، زي الفلتر.
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
  if (iso === null) return FOLLOW_UP_TEXT.missing
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return 'موعد المتابعة غير صالح.'
  if (at < nowMs - 5 * 60 * 1000) return 'موعد المتابعة يجب أن يكون في المستقبل.'
  if (at > nowMs + 366 * DAY_MS) return 'موعد المتابعة بعيد جدًا (أكثر من سنة).'
  return null
}

/**
 * تحقق فورم التواصل قبل النداء. followUpIso بيتحسب من قيمة datetime-local بتوقيت القاهرة.
 * الموعد مع «متابعة لاحقًا» بس (دالة A1 بترفضه مع أي نتيجة تانية — موعد اختياري مع «لا يجيب»/«الخط مشغول»
 * محتاج migration صغيرة مستقلة).
 */
export function callFormIssue(outcome: CallOutcome | null, followUpIso: string | null, note: string, nowMs: number): string | null {
  if (outcome === null) return 'اختر نتيجة التواصل.'
  if (note.trim().length > CALL_NOTE_MAX) return 'الملاحظة أطول من ' + String(CALL_NOTE_MAX) + ' حرف.'
  if (outcome === 'callback_later') return followUpIssue(followUpIso, nowMs)
  return null
}

// ── موعد التسليم المتفق عليه والفترات ──────────────────────────────────────
export const DELIVERY_PERIODS = ['morning', 'noon', 'evening'] as const
export type DeliveryPeriod = (typeof DELIVERY_PERIODS)[number]

export const DELIVERY_PERIOD_LABELS: Record<DeliveryPeriod, string> = {
  morning: 'صباحًا',
  noon: 'ظهرًا',
  evening: 'مساءً',
}

export const DELIVERY_TEXT = {
  title: 'موعد التسليم المتفق عليه',
  hint: 'هذا الموعد تم الاتفاق عليه مع العميل.',
  none: 'لا يوجد موعد تسليم متفق عليه.',
  noPeriod: 'بدون فترة محددة',
  dateLabel: 'التاريخ',
  periodLabel: 'الفترة المناسبة',
  noteLabel: 'ملاحظة (اختياري)',
  periodsTitle: 'الفترات المتاحة (بتوقيت القاهرة)',
  periodsUnavailable: 'الفترات غير متاحة حاليًا.',
  save: 'تحديد موعد التسليم',
  clear: 'إلغاء موعد التسليم',
  clearConfirm: 'هل تريد إلغاء موعد التسليم؟ سيظل الموعد السابق ظاهرًا في سجل الطلب.',
  saved: 'تم تحديد موعد التسليم.',
  cleared: 'تم إلغاء موعد التسليم.',
  locked: 'لا يمكن تعديل موعد التسليم بعد التسليم أو رفض الاستلام أو الإلغاء.',
} as const

export function isDeliveryPeriod(value: unknown): value is DeliveryPeriod {
  return typeof value === 'string' && (DELIVERY_PERIODS as readonly string[]).includes(value)
}

export type DeliveryInput = { date: string; period: string; note: string }
export type DeliveryValue = { date: string | null; period: DeliveryPeriod | null; note: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** نفس قواعد zell_order_set_confirmed_delivery: من غير تاريخ = إلغاء (ومفيش فترة ولا ملاحظة). */
export function deliveryValue(input: DeliveryInput): { ok: true; value: DeliveryValue } | { ok: false; message: string } {
  const date = input.date.trim()
  const note = input.note.trim()
  const period = input.period.trim()
  if (date === '') {
    if (period !== '' || note !== '') return { ok: false, message: 'حدد تاريخ التسليم أولًا، أو احذف الفترة والملاحظة.' }
    return { ok: true, value: { date: null, period: null, note: null } }
  }
  if (!DATE_RE.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))) return { ok: false, message: 'تاريخ التسليم غير صالح.' }
  if (period !== '' && !isDeliveryPeriod(period)) return { ok: false, message: 'الفترة المختارة غير متاحة.' }
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

// ── بيانات العميل (نفس قواعد zell_order_edit_details) ────────────────────
export type DetailsInput = { customerName: string; customerPhone: string; address: string; notes: string }
export type DetailsCurrent = { customerName: string; customerPhone: string; address: string; notes: string | null; hasCoupon: boolean }
export type DetailsChanges = Partial<{ customer_name: string; customer_phone: string; address: string; notes: string | null }>

export const CUSTOMER_TEXT = {
  title: 'بيانات العميل',
  edit: 'تعديل بيانات العميل',
  name: 'الاسم',
  phone: 'رقم الهاتف',
  address: 'العنوان',
  notes: 'ملاحظات العميل',
  save: 'حفظ التعديلات',
  saving: 'جارٍ الحفظ…',
  cancel: 'إلغاء',
  saved: 'تم تحديث بيانات العميل.',
  lockedFields: 'المنتجات والمحافظة والمنطقة والفني والكوبون وأي مبالغ لا يمكن تعديلها؛ لتغييرها ألغِ الطلب وأنشئ طلبًا جديدًا.',
} as const

export const INTERNAL_NOTES_TEXT = {
  title: 'ملاحظات داخلية',
  hint: 'لا تظهر للعميل',
  placeholder: 'ملاحظات للفريق — لا تظهر للعميل',
  dirty: 'توجد تغييرات غير محفوظة',
  saving: 'جارٍ الحفظ…',
  saved: 'تم حفظ الملاحظات الداخلية.',
  save: 'حفظ الملاحظات',
} as const

export const PHONE_RE = /^01[0125][0-9]{8}$/
export const PHONE_LOCKED_MESSAGE =
  'لا يمكن تغيير رقم الهاتف لأن الطلب مرتبط بكوبون. لتغييره ألغِ الطلب وأنشئ طلبًا جديدًا.'
export const NO_CHANGES_MESSAGE = 'لا توجد تغييرات للحفظ.'

export function detailsChanges(input: DetailsInput, current: DetailsCurrent): { ok: true; changes: DetailsChanges } | { ok: false; message: string } {
  const changes: DetailsChanges = {}
  const name = input.customerName.trim()
  const address = input.address.trim()
  const notesText = input.notes.trim()
  const notes = notesText === '' ? null : notesText
  const phone = input.customerPhone.trim()
  if (name !== current.customerName) {
    if (name.length < 3 || name.length > 100) return { ok: false, message: 'الاسم يجب أن يكون من 3 إلى 100 حرف.' }
    changes.customer_name = name
  }
  if (address !== current.address) {
    if (address.length < 8 || address.length > 500) return { ok: false, message: 'العنوان يجب أن يكون من 8 إلى 500 حرف.' }
    changes.address = address
  }
  if (notes !== current.notes) {
    if (notesText.length > 500) return { ok: false, message: 'ملاحظات العميل أطول من 500 حرف.' }
    changes.notes = notes
  }
  if (phone !== current.customerPhone) {
    if (current.hasCoupon) return { ok: false, message: PHONE_LOCKED_MESSAGE }
    if (!PHONE_RE.test(phone)) return { ok: false, message: 'رقم الهاتف يجب أن يكون 11 رقمًا ويبدأ بـ 010 أو 011 أو 012 أو 015.' }
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

// ── سجل الطلب ─────────────────────────────────────────────────────────
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

export const TIMELINE_TEXT = {
  title: 'سجل الطلب',
  empty: 'لا توجد أحداث مسجلة لهذا الطلب حتى الآن.',
  beforeLog: 'حدث قبل تفعيل سجل الطلب',
  unavailable: 'سجل الطلب غير متاح حاليًا. حدّث الصفحة.',
} as const

const FIELD_LABELS: Record<string, string> = {
  customer_name: 'الاسم',
  customer_phone: 'رقم الهاتف',
  address: 'العنوان',
  notes: 'ملاحظات العميل',
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

function quoted(value: unknown): string {
  const t = text(value)
  return t === null ? '(فارغ)' : '«' + t + '»'
}

function joinDetail(parts: Array<string | null>): string | null {
  const kept = parts.filter((p): p is string => p !== null && p !== '')
  return kept.length === 0 ? null : kept.join(' · ')
}

export type EventLine = { title: string; detail: string | null }

/**
 * وصف الحدث بالعربي. statusLabel بيرجّع اسم الحالة في اللوحة (ADMIN_STATUS_LABELS).
 * ممنوع يطلع اسم كود داخلي أو JSON خام: أي قيمة مش معروفة بتتعرض كنص عام.
 */
export function describeEvent(event: OrderEvent, statusLabel: (status: string) => string | null): EventLine {
  const p = event.payload
  const status = (value: unknown) => (typeof value === 'string' ? statusLabel(value) : null) ?? 'حالة غير معروفة'
  switch (event.kind) {
    case 'created':
      return { title: 'تم إنشاء الطلب', detail: null }
    case 'status_changed': {
      const reason = text(p['reason'])
      return {
        title: 'تم تغيير حالة الطلب',
        detail: joinDetail(['من «' + status(p['from']) + '» إلى «' + status(p['to']) + '»', reason === null ? null : reason === 'call' ? 'من نتيجة التواصل' : reason]),
      }
    }
    case 'call_attempt': {
      const outcome = p['outcome']
      return {
        title: 'تم تسجيل تواصل',
        detail: joinDetail(['النتيجة: ' + (isCallOutcome(outcome) ? CALL_OUTCOME_LABELS[outcome] : 'غير معروفة'), text(p['note'])]),
      }
    }
    case 'follow_up_set': {
      const next = text(p['new'])
      return {
        title: 'تم تحديث موعد المتابعة',
        detail: joinDetail([next === null ? 'تم إلغاء موعد المتابعة' : 'الموعد: ' + formatCairoDateTime(next), text(p['note'])]),
      }
    }
    case 'delivery_confirmed_set': {
      const next = typeof p['new'] === 'object' && p['new'] !== null ? (p['new'] as Record<string, unknown>) : {}
      const date = text(next['date'])
      const period = next['period']
      return {
        title: 'تم تحديث موعد التسليم',
        detail: joinDetail([
          date === null ? 'تم إلغاء موعد التسليم' : 'الموعد: ' + date + ' · ' + (isDeliveryPeriod(period) ? DELIVERY_PERIOD_LABELS[period] : DELIVERY_TEXT.noPeriod),
          text(next['note']),
        ]),
      }
    }
    case 'details_edited': {
      const label = FIELD_LABELS[String(p['field'] ?? '')] ?? 'بيان'
      return { title: 'تم تعديل بيانات العميل', detail: label + ': من ' + quoted(p['old']) + ' إلى ' + quoted(p['new']) }
    }
    case 'note_changed':
      return { title: 'تم تعديل الملاحظات الداخلية', detail: null }
    default:
      return { title: 'تم تسجيل حدث آخر على الطلب', detail: null }
  }
}

/** المنفّذ: null = النظام (زي إنشاء الطلب من المتجر). غير كده عضو في فريق الإدارة (من غير أي معرّف داخلي). */
export function actorLabel(actor: string | null): string {
  return actor === null ? 'بواسطة النظام' : 'بواسطة فريق الإدارة'
}

// ── أخطاء دوال zell_order_* ─────────────────────────────────────────────
export const ORDER_CONFLICT_MESSAGE = 'الطلب تغيّر من مكان آخر. حدّث الصفحة وراجع آخر تعديل.'
export const ORDER_INTERNAL_MESSAGE = 'تعذر تنفيذ الإجراء. حاول مرة أخرى.'
export const ORDER_NOT_FOUND_MESSAGE = 'الطلب غير موجود. ربما تم حذفه.'

export type OrderFailureKind =
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'cancelled_final' }
  | { kind: 'validation'; message: string }
  | { kind: 'internal' }

const VALIDATION_BY_CODE: Record<string, string> = {
  '45402': 'هذا الإجراء متاح للمالك فقط.',
  '45405': 'هذا الإجراء غير متاح على حالة الطلب الحالية. حدّث الصفحة.',
  '45406': 'هذه الحالة غير متاحة حاليًا.',
  '45407': 'تغيير حالة الطلب يتم من أزرار الطلب فقط.',
  '45408': 'البيانات غير صالحة. راجعها وحاول مرة أخرى.',
  '45409': FOLLOW_UP_TEXT.missing,
  '45410': 'هذا الإجراء غير متاح على حالة الطلب الحالية. حدّث الصفحة.',
  '45411': PHONE_LOCKED_MESSAGE,
  '45412': 'الفترات غير صالحة.',
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
