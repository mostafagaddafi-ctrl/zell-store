/**
 * 0021-A A2 — حالات دورة الطلب في اللوحة: الانتقالات والبوابة · المكالمة · وقت القاهرة · فلاتر المتابعة
 * · الموعد المؤكد والفترات · تعديل البيانات · سجل الأحداث · تحويل أخطاء zell_order_* .
 * منطق خالص بس (من غير داتابيز ولا شبكة). المشغّل: scripts/run-cases.mjs (suite «orders»).
 */
import type { OrderStatus } from '@zell/core'
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  NO_CHANGES_MESSAGE,
  NO_TRANSITIONS_MESSAGE,
  PHONE_LOCKED_MESSAGE,
  actorLabel,
  allowedTargets,
  cairoDayRange,
  cairoInputToIso,
  cairoToday,
  callFormIssue,
  callPanelOpen,
  deliveryEditable,
  deliveryValue,
  describeEvent,
  detailsChanges,
  followUpBucket,
  followUpQueryParts,
  isoToCairoInput,
  orderFailureKind,
  parseEvents,
  parseGateState,
  parsePeriods,
  parseWriteResult,
  periodLine,
  readFollowUpFilter,
  statusControls,
  type OrderEvent,
} from './cycle'

type Failure = { name: string; expected: string; actual: string }
export type OrderCasesReport = { passed: number; failures: Failure[] }

const ALL: OrderStatus[] = ['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'refused', 'cancelled']
const LABELS: Record<string, string> = {
  new: 'جديد',
  confirmed: 'مؤكد',
  preparing: 'بيتجهّز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  refused: 'رفض الاستلام',
  cancelled: 'ملغي',
}
const label = (s: string) => LABELS[s] ?? s
const CANCELLED = 'الطلب ده ملغي، والإلغاء نهائي — مينفعش يرجع لأي حالة تانية.'

export async function runOrderCases(): Promise<OrderCasesReport> {
  let passed = 0
  const failures: Failure[] = []
  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed++
    else failures.push({ name, expected: e, actual: a })
  }

  // ── T: الانتقالات والبوابة ──
  const targets = (s: OrderStatus, open: boolean | null) => allowedTargets(s, open).join(',')
  check('T1 closed: new -> confirmed, cancelled', targets('new', false), 'confirmed,cancelled')
  check('T2 closed: confirmed -> shipped, cancelled (legacy parity)', targets('confirmed', false), 'shipped,cancelled')
  check('T3 open: confirmed -> preparing, cancelled (no direct ship)', targets('confirmed', true), 'preparing,cancelled')
  check('T4 preparing: closed none · open shipped, cancelled', [targets('preparing', false), targets('preparing', true)], ['', 'shipped,cancelled'])
  check('T5 shipped: closed delivered · open delivered, refused', [targets('shipped', false), targets('shipped', true)], ['delivered', 'delivered,refused'])
  check('T6 final statuses have no targets', ['delivered', 'refused', 'cancelled'].map((s) => targets(s as OrderStatus, false) + '|' + targets(s as OrderStatus, true)), ['|', '|', '|'])
  check('T7 unknown gate = closed', ALL.map((s) => targets(s, null)), ALL.map((s) => targets(s, false)))
  check('T8 gate closed: preparing / refused never offered', ALL.flatMap((s) => allowedTargets(s, false)).filter((t) => t === 'preparing' || t === 'refused'), [])
  check('T9 no transition back to new, cancelled stays final', ALL.flatMap((s) => [...allowedTargets(s, false), ...allowedTargets(s, true)]).filter((t) => t === 'new').length, 0)
  check('T10 controls: cancelled final message', statusControls('cancelled', true, CANCELLED), { kind: 'final', message: CANCELLED })
  check('T11 controls: delivered none', statusControls('delivered', false, CANCELLED), { kind: 'none', message: NO_TRANSITIONS_MESSAGE })
  check('T12 controls: new buttons', statusControls('new', false, CANCELLED), { kind: 'buttons', targets: ['confirmed', 'cancelled'] })

  // ── C: المكالمة ──
  const NOW = Date.parse('2026-01-15T10:00:00.000Z')
  check('C1 seven outcomes in order', CALL_OUTCOMES.map((o) => o + '=' + CALL_OUTCOME_LABELS[o]), [
    'no_answer=مابيردش',
    'busy=مشغول',
    'wrong_number=رقم غلط',
    'callback_later=يتكلم بعدين',
    'confirmed=أكّد',
    'agreed_awaiting_deposit=وافق — منتظر المقدم',
    'customer_cancelled=لغى',
  ])
  check('C2 no outcome', callFormIssue(null, null, '', NOW), 'اختار نتيجة المكالمة.')
  check('C3 callback_later needs follow-up', callFormIssue('callback_later', null, '', NOW), 'اختار معاد المتابعة (تاريخ ووقت).')
  check('C4 callback_later in the past', callFormIssue('callback_later', '2026-01-15T09:00:00.000Z', '', NOW), 'معاد المتابعة لازم يكون في المستقبل.')
  check('C5 callback_later beyond a year', callFormIssue('callback_later', '2027-02-15T09:00:00.000Z', '', NOW), 'معاد المتابعة بعيد أوي (أكتر من سنة).')
  check('C6 callback_later valid', callFormIssue('callback_later', '2026-01-16T09:00:00.000Z', 'بعد العصر', NOW), null)
  check('C7 other outcomes ignore follow-up', CALL_OUTCOMES.filter((o) => o !== 'callback_later').map((o) => callFormIssue(o, null, '', NOW)), [null, null, null, null, null, null])
  check('C8 note max 300', [callFormIssue('busy', null, 'x'.repeat(300), NOW), callFormIssue('busy', null, 'x'.repeat(301), NOW)], [null, 'الملاحظة أطول من 300 حرف.'])
  check('C9 call panel only in new', ALL.filter(callPanelOpen), ['new'])
  check('C10 delivery editable until delivered / refused / cancelled', ALL.filter(deliveryEditable), ['new', 'confirmed', 'preparing', 'shipped'])

  // ── Z: وقت القاهرة ──
  check('Z1 winter: Cairo 10:00 = 08:00Z', cairoInputToIso('2026-01-15T10:00'), '2026-01-15T08:00:00.000Z')
  check('Z2 summer (DST): Cairo 10:00 = 07:00Z', cairoInputToIso('2026-07-15T10:00'), '2026-07-15T07:00:00.000Z')
  check('Z3 invalid inputs', [cairoInputToIso('2026-02-30T10:00'), cairoInputToIso('abc'), cairoInputToIso('2026-01-15 10:00'), cairoInputToIso('2026-01-15T24:00')], [null, null, null, null])
  check('Z4 round trip', [isoToCairoInput('2026-01-15T08:00:00.000Z'), isoToCairoInput('2026-07-15T07:00:00.000Z'), isoToCairoInput(null)], ['2026-01-15T10:00', '2026-07-15T10:00', ''])
  const late = cairoDayRange(Date.parse('2026-01-15T21:30:00.000Z'))
  check('Z5 day range at Cairo 23:30', [new Date(late.start).toISOString(), new Date(late.end).toISOString()], ['2026-01-14T22:00:00.000Z', '2026-01-15T22:00:00.000Z'])
  const early = cairoDayRange(Date.parse('2026-01-15T22:30:00.000Z'))
  check('Z6 day range just after Cairo midnight', [new Date(early.start).toISOString(), new Date(early.end).toISOString()], ['2026-01-15T22:00:00.000Z', '2026-01-16T22:00:00.000Z'])
  check('Z7 Cairo today', [cairoToday(Date.parse('2026-01-15T21:30:00.000Z')), cairoToday(Date.parse('2026-01-15T22:30:00.000Z'))], ['2026-01-15', '2026-01-16'])

  // ── F: فلاتر المتابعة ──
  const F_NOW = Date.parse('2026-01-15T10:00:00.000Z') // القاهرة 12:00
  check('F1 buckets', [
    followUpBucket('2026-01-15T09:00:00.000Z', 'new', F_NOW),
    followUpBucket('2026-01-15T20:00:00.000Z', 'new', F_NOW),
    followUpBucket('2026-01-15T22:00:00.000Z', 'new', F_NOW),
    followUpBucket('2026-01-20T08:00:00.000Z', 'new', F_NOW),
    followUpBucket(null, 'new', F_NOW),
    followUpBucket('2026-01-15T09:00:00.000Z', 'confirmed', F_NOW),
  ], ['overdue', 'today', 'upcoming', 'upcoming', null, null])
  check('F2 overdue query', followUpQueryParts('overdue', F_NOW), ['status=eq.new', 'next_follow_up_at=lt.2026-01-15T10%3A00%3A00.000Z', 'order=next_follow_up_at.asc,id.asc'])
  check('F3 today query', followUpQueryParts('today', F_NOW), [
    'status=eq.new',
    'next_follow_up_at=gte.2026-01-15T10%3A00%3A00.000Z',
    'next_follow_up_at=lt.2026-01-15T22%3A00%3A00.000Z',
    'order=next_follow_up_at.asc,id.asc',
  ])
  check('F4 upcoming query', followUpQueryParts('upcoming', F_NOW), ['status=eq.new', 'next_follow_up_at=gte.2026-01-15T22%3A00%3A00.000Z', 'order=next_follow_up_at.asc,id.asc'])
  check('F5 read filter', [readFollowUpFilter('today'), readFollowUpFilter('overdue'), readFollowUpFilter('upcoming'), readFollowUpFilter('x'), readFollowUpFilter(undefined)], ['today', 'overdue', 'upcoming', null, null])

  // ── D: الموعد المؤكد والفترات ──
  check('D1 clear', deliveryValue({ date: '', period: '', note: '' }), { ok: true, value: { date: null, period: null, note: null } })
  check('D2 date only', deliveryValue({ date: '2026-01-20', period: '', note: ' ' }), { ok: true, value: { date: '2026-01-20', period: null, note: null } })
  check('D3 date + period + note', deliveryValue({ date: '2026-01-20', period: 'noon', note: ' اتصل قبلها ' }), { ok: true, value: { date: '2026-01-20', period: 'noon', note: 'اتصل قبلها' } })
  check('D4 period without date', deliveryValue({ date: '', period: 'noon', note: '' }), { ok: false, message: 'اختار التاريخ الأول، أو امسح الفترة والملاحظة.' })
  check('D5 unknown period', deliveryValue({ date: '2026-01-20', period: 'night', note: '' }), { ok: false, message: 'الفترة مش من التلاتة.' })
  check('D6 bad date / long note', [deliveryValue({ date: '20-01-2026', period: '', note: '' }).ok, deliveryValue({ date: '2026-01-20', period: '', note: 'x'.repeat(201) }).ok], [false, false])
  const periods = parsePeriods({
    updated_at: '2026-01-01T00:00:00Z',
    periods: [
      { period: 'morning', starts_at: '09:00', ends_at: '12:00' },
      { period: 'noon', starts_at: '12:00', ends_at: '17:00' },
      { period: 'evening', starts_at: '17:00', ends_at: '21:00' },
    ],
  })
  check('D7 periods parsed + lines', periods === null ? null : periods.periods.map(periodLine), ['الصبح 09:00–12:00', 'الضهر 12:00–17:00', 'بالليل 17:00–21:00'])
  check('D8 bad periods shape', [parsePeriods(null), parsePeriods({ updated_at: 'x', periods: [{ period: 'night', starts_at: '1', ends_at: '2' }] })], [null, null])

  // ── E: تعديل البيانات ──
  const CUR = { customerName: 'أحمد علي', customerPhone: '01012345678', address: 'شارع التحرير، الدقي', notes: null, hasCoupon: false }
  const SAME = { customerName: 'أحمد علي', customerPhone: '01012345678', address: 'شارع التحرير، الدقي', notes: '' }
  check('E1 nothing changed', detailsChanges(SAME, CUR), { ok: false, message: NO_CHANGES_MESSAGE })
  check('E2 only changed fields, trimmed', detailsChanges({ ...SAME, customerName: '  أحمد محمد علي ', notes: ' الدور التالت ' }, CUR), { ok: true, changes: { customer_name: 'أحمد محمد علي', notes: 'الدور التالت' } })
  check('E3 phone allowed without coupon', detailsChanges({ ...SAME, customerPhone: '01198765432' }, CUR), { ok: true, changes: { customer_phone: '01198765432' } })
  check('E4 phone locked with coupon', detailsChanges({ ...SAME, customerPhone: '01198765432' }, { ...CUR, hasCoupon: true }), { ok: false, message: PHONE_LOCKED_MESSAGE })
  check('E5 same phone with coupon is fine', detailsChanges({ ...SAME, address: 'شارع جديد طويل كفاية' }, { ...CUR, hasCoupon: true }), { ok: true, changes: { address: 'شارع جديد طويل كفاية' } })
  check('E6 validation', [
    detailsChanges({ ...SAME, customerName: 'اب' }, CUR).ok,
    detailsChanges({ ...SAME, address: 'قصير' }, CUR).ok,
    detailsChanges({ ...SAME, customerPhone: '0101' }, CUR).ok,
    detailsChanges({ ...SAME, customerPhone: '01312345678' }, CUR).ok,
  ], [false, false, false, false])
  check('E7 clearing customer notes = null', detailsChanges(SAME, { ...CUR, notes: 'قديمة' }), { ok: true, changes: { notes: null } })

  // ── V: سجل الأحداث ──
  const raw = [
    { id: 9, kind: 'status_changed', actor: '11111111-2222-3333-4444-555555555555', created_at: '2026-01-15T10:05:00Z', payload: { from: 'new', to: 'confirmed', reason: 'call' } },
    { id: 8, kind: 'call_attempt', actor: '11111111-2222-3333-4444-555555555555', created_at: '2026-01-15T10:05:00Z', payload: { outcome: 'confirmed' } },
    { id: 1, kind: 'created', actor: null, created_at: '2026-01-15T09:00:00Z', payload: { status: 'new' } },
  ]
  const events = parseEvents(raw)
  check('V1 parse events (newest first kept)', events === null ? null : events.map((e) => e.id + ':' + e.kind), ['9:status_changed', '8:call_attempt', '1:created'])
  check('V2 bad events shape', [parseEvents(null), parseEvents([{ id: '1', kind: 'x', created_at: 'y' }]), parseEvents([])], [null, null, []])
  const ev = (kind: string, payload: Record<string, unknown>): OrderEvent => ({ id: 1, kind, actor: null, createdAt: '2026-01-15T10:00:00Z', payload })
  check('V3 describe', [
    describeEvent(ev('created', {}), label),
    describeEvent(ev('status_changed', { from: 'new', to: 'confirmed', reason: 'call' }), label),
    describeEvent(ev('status_changed', { from: 'shipped', to: 'refused', reason: 'مارضيش يستلم' }), label),
    describeEvent(ev('call_attempt', { outcome: 'busy', note: 'هيكلمنا' }), label),
    describeEvent(ev('follow_up_set', { old: '2026-01-16T08:00:00Z', new: null }), label),
    describeEvent(ev('delivery_confirmed_set', { old: {}, new: { date: '2026-01-20', period: 'evening', note: 'قبلها بساعة' } }), label),
    describeEvent(ev('delivery_confirmed_set', { old: {}, new: { date: null, period: null, note: null } }), label),
    describeEvent(ev('details_edited', { field: 'customer_phone', old: '01012345678', new: '01198765432' }), label),
    describeEvent(ev('details_edited', { field: 'notes', old: 'قديمة', new: null }), label),
    describeEvent(ev('note_changed', { new: 'x' }), label),
    describeEvent(ev('payment_recorded', {}), label),
  ], [
    { title: 'الطلب اتعمل', detail: null },
    { title: 'الحالة اتغيّرت من «جديد» لـ «مؤكد»', detail: 'من نتيجة المكالمة' },
    { title: 'الحالة اتغيّرت من «تم الشحن» لـ «رفض الاستلام»', detail: 'مارضيش يستلم' },
    { title: 'مكالمة: مشغول', detail: 'هيكلمنا' },
    { title: 'معاد المتابعة اتشال', detail: null },
    { title: 'معاد التسليم المؤكد: 2026-01-20 · بالليل', detail: 'قبلها بساعة' },
    { title: 'معاد التسليم المؤكد اتشال', detail: null },
    { title: 'اتعدّل الموبايل', detail: 'من «01012345678» لـ «01198765432»' },
    { title: 'اتعدّل ملاحظات الزبون', detail: 'من «قديمة» لـ (فاضي)' },
    { title: 'الملاحظات الداخلية اتعدّلت', detail: null },
    { title: 'حدث: payment_recorded', detail: null },
  ])
  check('V4 follow-up set shows Cairo time', describeEvent(ev('follow_up_set', { new: '2026-01-16T08:00:00Z', note: 'بعد العصر' }), label).title.startsWith('معاد المتابعة: '), true)
  check('V5 actor', [actorLabel(null), actorLabel('11111111-2222-3333-4444-555555555555')], ['النظام', 'أدمن 11111111'])

  // ── R: أخطاء الدوال ونتيجة الكتابة ──
  const kind = (code: string) => orderFailureKind({ code, message: 'x' }, 400)
  check('R1 identity / lookup / conflict / cancelled', [kind('45400'), kind('45401'), kind('45403'), kind('45404'), kind('45080')].map((k) => k.kind), ['unauthenticated', 'forbidden', 'not_found', 'conflict', 'cancelled_final'])
  check('R2 validation codes', ['45402', '45405', '45406', '45407', '45408', '45409', '45410', '45411', '45412'].map((c) => kind(c).kind), Array(9).fill('validation'))
  check('R3 phone with coupon message', kind('45411'), { kind: 'validation', message: PHONE_LOCKED_MESSAGE })
  check('R4 sentinel in message when code is missing', [orderFailureKind({ message: 'ZELL_ORD_CONFLICT' }, 400).kind, orderFailureKind({ message: 'ZELL_ORDER_CANCELLED_FINAL' }, 400).kind], ['conflict', 'cancelled_final'])
  check('R5 401 = unauthenticated, other = internal', [orderFailureKind({ code: 'PGRST301' }, 401).kind, orderFailureKind({ code: '42501', message: 'permission denied' }, 403).kind, orderFailureKind(null, 500).kind], ['unauthenticated', 'internal', 'internal'])
  check('R6 write result', [parseWriteResult({ ok: true, order_id: 7, status: 'confirmed', updated_at: '2026-01-15T10:00:00Z' }), parseWriteResult({ ok: false })], [{ orderId: 7, status: 'confirmed', updatedAt: '2026-01-15T10:00:00Z' }, null])
  check('R7 gate state', [parseGateState({ is_open: false, changed_at: '2026-01-01T00:00:00Z' }), parseGateState({ is_open: 'no' })], [{ isOpen: false, changedAt: '2026-01-01T00:00:00Z' }, null])

  return { passed, failures }
}
