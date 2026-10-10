/**
 * 0021-A A2 — حالات دورة الطلب في اللوحة: الانتقالات والبوابة · نصوص لوحة الطلبات · التواصل · وقت القاهرة · فلاتر المتابعة
 * · موعد التسليم والفترات · بيانات العميل · سجل الطلب (من غير أكواد داخلية) · تحويل أخطاء zell_order_* .
 * منطق خالص بس (من غير داتابيز ولا شبكة). المشغّل: scripts/run-cases.mjs (suite «orders»).
 */
import type { OrderStatus } from '@zell/core'
import {
  ADMIN_STATUS_LABELS,
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  CALL_TEXT,
  CANCELLED_FINAL_MESSAGE,
  CUSTOMER_TEXT,
  DELIVERY_PERIOD_LABELS,
  DELIVERY_TEXT,
  FOLLOW_UP_FILTER_LABELS,
  FOLLOW_UP_TEXT,
  INTERNAL_NOTES_TEXT,
  NO_CHANGES_MESSAGE,
  NO_TRANSITIONS_MESSAGE,
  ORDER_CONFLICT_MESSAGE,
  ORDER_INTERNAL_MESSAGE,
  PHONE_LOCKED_MESSAGE,
  TIMELINE_TEXT,
  TRANSITION_ACTION_LABELS,
  TRANSITION_SAVED_MESSAGE,
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
  formatCairoDateTime,
  isoToCairoInput,
  orderFailureKind,
  parseEvents,
  parseGateState,
  parsePeriods,
  parseWriteResult,
  periodLine,
  preferredLine,
  preferredTitle,
  readFollowUpFilter,
  statusControls,
  transitionConfirmation,
  type OrderEvent,
} from './cycle'

type Failure = { name: string; expected: string; actual: string }
export type OrderCasesReport = { passed: number; failures: Failure[] }

const ALL: OrderStatus[] = ['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'refused', 'cancelled']
const label = (s: string): string | null => (ADMIN_STATUS_LABELS as Readonly<Record<string, string>>)[s] ?? null
/** أي حرف لاتيني في نص ظاهر = كود داخلي اتسرّب (التواريخ والأرقام مسموحة). */
const LATIN = /[A-Za-z_]/

export async function runOrderCases(): Promise<OrderCasesReport> {
  let passed = 0
  const failures: Failure[] = []
  function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) passed++
    else failures.push({ name, expected: e, actual: a })
  }

  // ── L: نصوص لوحة الطلبات ──
  check('L1 admin status labels', ALL.map((s) => s + '=' + ADMIN_STATUS_LABELS[s]), [
    'new=طلب جديد',
    'confirmed=تم التأكيد',
    'preparing=قيد التجهيز',
    'shipped=تم الشحن',
    'delivered=تم التسليم',
    'refused=رفض الاستلام',
    'cancelled=ملغى',
  ])
  check('L2 contact outcomes (internal values unchanged)', CALL_OUTCOMES.map((o) => o + '=' + CALL_OUTCOME_LABELS[o]), [
    'no_answer=لا يجيب',
    'busy=الخط مشغول',
    'wrong_number=رقم غير صحيح',
    'callback_later=متابعة لاحقًا',
    'confirmed=تم تأكيد الطلب',
    'agreed_awaiting_deposit=وافق — بانتظار الدفعة المقدمة',
    'customer_cancelled=ألغى الطلب',
  ])
  check('L3 contact texts', [CALL_TEXT.title, CALL_TEXT.outcomeLabel, CALL_TEXT.noteLabel, CALL_TEXT.submit, CALL_TEXT.saved], [
    'نتيجة التواصل',
    'نتيجة التواصل',
    'ملاحظة التواصل (اختياري)',
    'حفظ نتيجة التواصل',
    'تم حفظ نتيجة التواصل.',
  ])
  check('L4 transition verbs', ['confirmed', 'preparing', 'shipped', 'delivered', 'refused', 'cancelled'].map((s) => TRANSITION_ACTION_LABELS[s as OrderStatus]), [
    'تأكيد الطلب',
    'بدء التجهيز',
    'تسجيل الشحن',
    'تسجيل التسليم',
    'تسجيل رفض الاستلام',
    'إلغاء الطلب',
  ])
  check('L5 confirmations: cancel / deliver / refuse only', ALL.filter((s) => transitionConfirmation(s) !== null), ['delivered', 'refused', 'cancelled'])
  check('L6 transition saved', TRANSITION_SAVED_MESSAGE, 'تم تغيير حالة الطلب.')
  check('L7 follow-up texts', [FOLLOW_UP_TEXT.clear, FOLLOW_UP_TEXT.clearConfirm, FOLLOW_UP_TEXT.saved, FOLLOW_UP_TEXT.cleared, FOLLOW_UP_TEXT.missing], [
    'إلغاء موعد المتابعة',
    'هل تريد إلغاء موعد المتابعة؟ سيظل الموعد السابق ظاهرًا في سجل الطلب.',
    'تم تحديد موعد المتابعة.',
    'تم إلغاء موعد المتابعة.',
    'حدد موعد المتابعة أولًا.',
  ])
  check('L8 follow-up filters', [FOLLOW_UP_FILTER_LABELS.overdue, FOLLOW_UP_FILTER_LABELS.today, FOLLOW_UP_FILTER_LABELS.upcoming], ['متابعة متأخرة', 'متابعة اليوم', 'متابعة قادمة'])
  check('L9 delivery texts + periods', [DELIVERY_TEXT.title, DELIVERY_TEXT.periodLabel, DELIVERY_TEXT.clear, DELIVERY_TEXT.hint, DELIVERY_TEXT.saved, DELIVERY_TEXT.cleared, DELIVERY_PERIOD_LABELS.morning, DELIVERY_PERIOD_LABELS.noon, DELIVERY_PERIOD_LABELS.evening], [
    'موعد التسليم المتفق عليه',
    'الفترة المناسبة',
    'إلغاء موعد التسليم',
    'هذا الموعد تم الاتفاق عليه مع العميل.',
    'تم تحديد موعد التسليم.',
    'تم إلغاء موعد التسليم.',
    'صباحًا',
    'ظهرًا',
    'مساءً',
  ])
  check('L10 customer + internal notes', [CUSTOMER_TEXT.title, CUSTOMER_TEXT.notes, CUSTOMER_TEXT.save, CUSTOMER_TEXT.saved, INTERNAL_NOTES_TEXT.title, INTERNAL_NOTES_TEXT.hint], [
    'بيانات العميل',
    'ملاحظات العميل',
    'حفظ التعديلات',
    'تم تحديث بيانات العميل.',
    'ملاحظات داخلية',
    'لا تظهر للعميل',
  ])
  check('L11 timeline texts', [TIMELINE_TEXT.title, TIMELINE_TEXT.beforeLog, TIMELINE_TEXT.empty], ['سجل الطلب', 'حدث قبل تفعيل سجل الطلب', 'لا توجد أحداث مسجلة لهذا الطلب حتى الآن.'])
  check('L12 general errors', [ORDER_CONFLICT_MESSAGE, ORDER_INTERNAL_MESSAGE], ['الطلب تغيّر من مكان آخر. حدّث الصفحة وراجع آخر تعديل.', 'تعذر تنفيذ الإجراء. حاول مرة أخرى.'])
  check('L13 the word «زبون» is not used in admin order texts', [CUSTOMER_TEXT, DELIVERY_TEXT, CALL_TEXT, INTERNAL_NOTES_TEXT].map((t) => Object.values(t).some((v) => v.includes('زبون'))), [false, false, false, false])

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
  check('T9 no transition back to new', ALL.flatMap((s) => [...allowedTargets(s, false), ...allowedTargets(s, true)]).filter((t) => t === 'new').length, 0)
  check('T10 controls: cancelled final message', statusControls('cancelled', true, CANCELLED_FINAL_MESSAGE), { kind: 'final', message: 'هذا الطلب ملغى، والإلغاء نهائي ولا يمكن إعادته لأي حالة أخرى.' })
  check('T11 controls: delivered none', statusControls('delivered', false, CANCELLED_FINAL_MESSAGE), { kind: 'none', message: NO_TRANSITIONS_MESSAGE })
  check('T12 controls: new buttons', statusControls('new', false, CANCELLED_FINAL_MESSAGE), { kind: 'buttons', targets: ['confirmed', 'cancelled'] })

  // ── C: التواصل ──
  const NOW = Date.parse('2026-01-15T10:00:00.000Z')
  check('C1 no outcome', callFormIssue(null, null, '', NOW), 'اختر نتيجة التواصل.')
  check('C2 «متابعة لاحقًا» needs date and time', callFormIssue('callback_later', null, '', NOW), 'حدد موعد المتابعة أولًا.')
  check('C3 follow-up in the past', callFormIssue('callback_later', '2026-01-15T09:00:00.000Z', '', NOW), 'موعد المتابعة يجب أن يكون في المستقبل.')
  check('C4 follow-up beyond a year', callFormIssue('callback_later', '2027-02-15T09:00:00.000Z', '', NOW), 'موعد المتابعة بعيد جدًا (أكثر من سنة).')
  check('C5 follow-up valid', callFormIssue('callback_later', '2026-01-16T09:00:00.000Z', 'بعد العصر', NOW), null)
  check('C6 other outcomes ignore follow-up (A1: date only with «متابعة لاحقًا»)', CALL_OUTCOMES.filter((o) => o !== 'callback_later').map((o) => callFormIssue(o, null, '', NOW)), [null, null, null, null, null, null])
  check('C7 note max 300', [callFormIssue('busy', null, 'x'.repeat(300), NOW), callFormIssue('busy', null, 'x'.repeat(301), NOW)], [null, 'الملاحظة أطول من 300 حرف.'])
  check('C8 contact panel only for new orders', ALL.filter(callPanelOpen), ['new'])
  check('C9 delivery editable until delivered / refused / cancelled', ALL.filter(deliveryEditable), ['new', 'confirmed', 'preparing', 'shipped'])

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
  check('Z8 date-time shown with the Cairo zone', formatCairoDateTime('2026-01-15T08:00:00.000Z').endsWith('(بتوقيت القاهرة)'), true)

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

  // ── D: موعد التسليم والفترات ──
  check('D1 clear', deliveryValue({ date: '', period: '', note: '' }), { ok: true, value: { date: null, period: null, note: null } })
  check('D2 date only', deliveryValue({ date: '2026-01-20', period: '', note: ' ' }), { ok: true, value: { date: '2026-01-20', period: null, note: null } })
  check('D3 date + period + note', deliveryValue({ date: '2026-01-20', period: 'noon', note: ' اتصل قبلها ' }), { ok: true, value: { date: '2026-01-20', period: 'noon', note: 'اتصل قبلها' } })
  check('D4 period without date', deliveryValue({ date: '', period: 'noon', note: '' }), { ok: false, message: 'حدد تاريخ التسليم أولًا، أو احذف الفترة والملاحظة.' })
  check('D5 unknown period', deliveryValue({ date: '2026-01-20', period: 'night', note: '' }), { ok: false, message: 'الفترة المختارة غير متاحة.' })
  check('D6 bad date / long note', [deliveryValue({ date: '20-01-2026', period: '', note: '' }).ok, deliveryValue({ date: '2026-01-20', period: '', note: 'x'.repeat(201) }).ok], [false, false])
  const periods = parsePeriods({
    updated_at: '2026-01-01T00:00:00Z',
    periods: [
      { period: 'morning', starts_at: '09:00', ends_at: '12:00' },
      { period: 'noon', starts_at: '12:00', ends_at: '17:00' },
      { period: 'evening', starts_at: '17:00', ends_at: '21:00' },
    ],
  })
  check('D7 periods parsed + lines', periods === null ? null : periods.periods.map(periodLine), ['صباحًا 09:00–12:00', 'ظهرًا 12:00–17:00', 'مساءً 17:00–21:00'])
  check('D8 bad periods shape', [parsePeriods(null), parsePeriods({ updated_at: 'x', periods: [{ period: 'night', starts_at: '1', ends_at: '2' }] })], [null, null])

  // ── E: بيانات العميل ──
  const CUR = { customerName: 'أحمد علي', customerPhone: '01012345678', address: 'شارع التحرير، الدقي', notes: null, hasCoupon: false }
  const SAME = { customerName: 'أحمد علي', customerPhone: '01012345678', address: 'شارع التحرير، الدقي', notes: '' }
  check('E1 nothing changed', detailsChanges(SAME, CUR), { ok: false, message: NO_CHANGES_MESSAGE })
  check('E2 only changed fields, trimmed', detailsChanges({ ...SAME, customerName: '  أحمد محمد علي ', notes: ' الدور الثالث ' }, CUR), { ok: true, changes: { customer_name: 'أحمد محمد علي', notes: 'الدور الثالث' } })
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

  // ── V: سجل الطلب ──
  const raw = [
    { id: 9, kind: 'status_changed', actor: '11111111-2222-3333-4444-555555555555', created_at: '2026-01-15T10:05:00Z', payload: { from: 'new', to: 'confirmed', reason: 'call' } },
    { id: 8, kind: 'call_attempt', actor: '11111111-2222-3333-4444-555555555555', created_at: '2026-01-15T10:05:00Z', payload: { outcome: 'confirmed' } },
    { id: 1, kind: 'created', actor: null, created_at: '2026-01-15T09:00:00Z', payload: { status: 'new' } },
  ]
  const events = parseEvents(raw)
  check('V1 parse events (newest first kept)', events === null ? null : events.map((e) => e.id + ':' + e.kind), ['9:status_changed', '8:call_attempt', '1:created'])
  check('V2 bad events shape', [parseEvents(null), parseEvents([{ id: '1', kind: 'x', created_at: 'y' }]), parseEvents([])], [null, null, []])
  const ev = (kind: string, payload: Record<string, unknown>): OrderEvent => ({ id: 1, kind, actor: null, createdAt: '2026-01-15T10:00:00Z', payload })
  check('V3 titles', ['created', 'status_changed', 'details_edited', 'call_attempt', 'follow_up_set', 'delivery_confirmed_set', 'note_changed', 'payment_recorded'].map((k) => describeEvent(ev(k, {}), label).title), [
    'تم إنشاء الطلب',
    'تم تغيير حالة الطلب',
    'تم تعديل بيانات العميل',
    'تم تسجيل تواصل',
    'تم تحديث موعد المتابعة',
    'تم تحديث موعد التسليم',
    'تم تعديل الملاحظات الداخلية',
    'تم تسجيل حدث آخر على الطلب',
  ])
  check('V4 details', [
    describeEvent(ev('status_changed', { from: 'new', to: 'confirmed', reason: 'call' }), label).detail,
    describeEvent(ev('status_changed', { from: 'shipped', to: 'refused', reason: 'رفض الاستلام عند الباب' }), label).detail,
    describeEvent(ev('call_attempt', { outcome: 'busy', note: 'سيعاود الاتصال' }), label).detail,
    describeEvent(ev('follow_up_set', { old: '2026-01-16T08:00:00Z', new: null }), label).detail,
    describeEvent(ev('delivery_confirmed_set', { old: {}, new: { date: '2026-01-20', period: 'evening', note: 'قبلها بساعة' } }), label).detail,
    describeEvent(ev('delivery_confirmed_set', { old: {}, new: { date: null, period: null, note: null } }), label).detail,
    describeEvent(ev('details_edited', { field: 'customer_phone', old: '01012345678', new: '01198765432' }), label).detail,
    describeEvent(ev('details_edited', { field: 'notes', old: 'قديمة', new: null }), label).detail,
  ], [
    'من «طلب جديد» إلى «تم التأكيد» · من نتيجة التواصل',
    'من «تم الشحن» إلى «رفض الاستلام» · رفض الاستلام عند الباب',
    'النتيجة: الخط مشغول · سيعاود الاتصال',
    'تم إلغاء موعد المتابعة',
    'الموعد: 2026-01-20 · مساءً · قبلها بساعة',
    'تم إلغاء موعد التسليم',
    'رقم الهاتف: من «01012345678» إلى «01198765432»',
    'ملاحظات العميل: من «قديمة» إلى (فارغ)',
  ])
  const leaky = [
    describeEvent(ev('status_changed', { from: 'weird_state', to: 'other_state' }), label),
    describeEvent(ev('call_attempt', { outcome: 'strange_value' }), label),
    describeEvent(ev('details_edited', { field: 'secret_column', old: 'أ', new: 'ب' }), label),
    describeEvent(ev('payment_refunded', { amount: 5 }), label),
    describeEvent(ev('delivery_confirmed_set', { new: { date: '2026-01-20', period: 'night' } }), label),
  ]
  check('V5 no internal codes or raw JSON in shown text', leaky.filter((l) => LATIN.test(l.title) || (l.detail !== null && (LATIN.test(l.detail) || l.detail.includes('{')))).length, 0)
  check('V6 follow-up detail shows Cairo time', (describeEvent(ev('follow_up_set', { new: '2026-01-16T08:00:00Z', note: 'بعد العصر' }), label).detail ?? '').includes('(بتوقيت القاهرة)'), true)
  check('V7 actor without internal ids', [actorLabel(null), actorLabel('11111111-2222-3333-4444-555555555555')], ['بواسطة النظام', 'بواسطة فريق الإدارة'])

  // ── R: أخطاء الدوال ونتيجة الكتابة ──
  const kind = (code: string) => orderFailureKind({ code, message: 'x' }, 400)
  check('R1 identity / lookup / conflict / cancelled', [kind('45400'), kind('45401'), kind('45403'), kind('45404'), kind('45080')].map((k) => k.kind), ['unauthenticated', 'forbidden', 'not_found', 'conflict', 'cancelled_final'])
  check('R2 validation codes', ['45402', '45405', '45406', '45407', '45408', '45409', '45410', '45411', '45412'].map((c) => kind(c).kind), Array(9).fill('validation'))
  check('R3 missing follow-up / phone with coupon', [kind('45409'), kind('45411')], [{ kind: 'validation', message: 'حدد موعد المتابعة أولًا.' }, { kind: 'validation', message: PHONE_LOCKED_MESSAGE }])
  check('R4 sentinel in message when code is missing', [orderFailureKind({ message: 'ZELL_ORD_CONFLICT' }, 400).kind, orderFailureKind({ message: 'ZELL_ORDER_CANCELLED_FINAL' }, 400).kind], ['conflict', 'cancelled_final'])
  check('R5 401 = unauthenticated, other = internal', [orderFailureKind({ code: 'PGRST301' }, 401).kind, orderFailureKind({ code: '42501', message: 'permission denied' }, 403).kind, orderFailureKind(null, 500).kind], ['unauthenticated', 'internal', 'internal'])
  check('R6 validation messages carry no codes', ['45402', '45405', '45406', '45407', '45408', '45409', '45410', '45411', '45412'].map((c) => kind(c)).filter((k) => k.kind === 'validation' && LATIN.test(k.message)).length, 0)
  check('R7 write result', [parseWriteResult({ ok: true, order_id: 7, status: 'confirmed', updated_at: '2026-01-15T10:00:00Z' }), parseWriteResult({ ok: false })], [{ orderId: 7, status: 'confirmed', updatedAt: '2026-01-15T10:00:00Z' }, null])
  check('R8 gate state', [parseGateState({ is_open: false, changed_at: '2026-01-01T00:00:00Z' }), parseGateState({ is_open: 'no' })], [{ isOpen: false, changedAt: '2026-01-01T00:00:00Z' }, null])

  // ── PD: موعد العميل المفضّل (0021-D) ──
  check('PD1 preferred title', [preferredTitle(false), preferredTitle(true)], ['موعد مفضل — بانتظار التأكيد', 'موعد مفضل من العميل'])
  check('PD2 preferred line', [preferredLine({ date: '2026-01-20', period: 'noon', note: null }), preferredLine({ date: '2026-01-20', period: null, note: 'x' })], ['2026-01-20 · ظهرًا', '2026-01-20 · بدون فترة محددة'])

  return { passed, failures }
}
