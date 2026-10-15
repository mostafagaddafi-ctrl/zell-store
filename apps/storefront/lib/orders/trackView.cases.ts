/**
 * TRACK-ORDER v2 W2-A — حالات عرض «تتبّع طلبك» (suite track، بتتجمّع من trackOrder.cases.ts).
 * العقد: docs/contracts/TRACK-ORDER-v2.md §٣ · §٤ · §٧ · §٨ · §٩ · §١٧-١.
 */

import { T0, T1, T2, T3, T4, history, money, orderOf } from './trackOrder.fixtures'
import {
  ORDER_NUMBER_KEEP,
  TRACK_PAGE_HREF,
  TRACK_TEXT,
  addCalendarDays,
  cairoDate,
  trackEta,
  trackMoneyLines,
  trackNextStep,
  trackShippingView,
  trackSegments,
  trackStages,
  trackWhatsappHref,
  type TrackStagesView,
} from './trackView'

type Failure = { name: string; expected: string; actual: string }

const failures: Failure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

/** «المفتاح:الحالة:مكتملة:الوقت:التعليق» لكل مرحلة. */
function brief(view: TrackStagesView): string[] {
  return view.stages.map((s) => s.key + ':' + s.state + ':' + (s.completed ? 1 : 0) + ':' + (s.at ?? '-') + ':' + (s.caption ?? '-'))
}

export function runTrackViewCases(): { passed: number; failures: Failure[] } {
  // ── خط المراحل (§٤) ──
  const fresh = trackStages(orderOf({ status: 'new', history: history(['new', T0]) }))
  check('S01 new: receipt is the current (completed) stage, the rest grey', [brief(fresh), fresh.banner, fresh.historyNote], [
    ['received:current:1:' + T0 + ':-', 'confirmed:upcoming:0:-:-', 'preparing:upcoming:0:-:-', 'shipped:upcoming:0:-:-', 'delivered:upcoming:0:-:-'], null, null,
  ])
  check('S02 confirmed: confirmation current with its real time', brief(trackStages(orderOf())), [
    'received:done:1:' + T0 + ':-', 'confirmed:current:1:' + T1 + ':-', 'preparing:upcoming:0:-:-', 'shipped:upcoming:0:-:-', 'delivered:upcoming:0:-:-',
  ])
  const preparing = trackStages(orderOf({ status: 'preparing', history: history(['new', T0], ['confirmed', T1], ['preparing', T2]) }))
  check('S03 preparing: «جارٍ التجهيز» is current, not completed, with its start time', [brief(preparing), preparing.stages[2]?.label], [
    ['received:done:1:' + T0 + ':-', 'confirmed:done:1:' + T1 + ':-', 'preparing:current:0:' + T2 + ':-', 'shipped:upcoming:0:-:-', 'delivered:upcoming:0:-:-'], TRACK_TEXT.preparingNow,
  ])
  const shippedViaPrep = trackStages(orderOf({ status: 'shipped', history: history(['new', T0], ['confirmed', T1], ['preparing', T2], ['shipped', T3]) }))
  check('S04 preparing → shipped: «تم التجهيز» completed at the shipping time', [brief(shippedViaPrep), shippedViaPrep.stages[2]?.label], [
    ['received:done:1:' + T0 + ':-', 'confirmed:done:1:' + T1 + ':-', 'preparing:done:1:' + T3 + ':-', 'shipped:current:1:' + T3 + ':-', 'delivered:upcoming:0:-:-'], TRACK_TEXT.preparingDone,
  ])
  const skipped = trackStages(orderOf({ status: 'shipped', history: history(['new', T0], ['confirmed', T1], ['shipped', T3]) }))
  check('S05 confirmed → shipped (gate closed): preparing stays grey with «لم تُسجَّل», never completed', brief(skipped), [
    'received:done:1:' + T0 + ':-', 'confirmed:done:1:' + T1 + ':-', 'preparing:upcoming:0:-:' + TRACK_TEXT.skipped, 'shipped:current:1:' + T3 + ':-', 'delivered:upcoming:0:-:-',
  ])
  const delivered = trackStages(orderOf({ status: 'delivered', history: history(['new', T0], ['confirmed', T1], ['preparing', T2], ['shipped', T3], ['delivered', T4]) }))
  check('S07 delivered: all five completed, delivery is current', brief(delivered), [
    'received:done:1:' + T0 + ':-', 'confirmed:done:1:' + T1 + ':-', 'preparing:done:1:' + T3 + ':-', 'shipped:done:1:' + T3 + ':-', 'delivered:current:1:' + T4 + ':-',
  ])
  const cancelled = trackStages(orderOf({ status: 'cancelled', history: history(['new', T0], ['confirmed', T1], ['cancelled', T2]) }))
  check('S08 cancelled after confirmation: banner with its time, what happened stays, nothing after is completed, no current', [brief(cancelled), cancelled.banner], [
    ['received:done:1:' + T0 + ':-', 'confirmed:done:1:' + T1 + ':-', 'preparing:upcoming:0:-:-', 'shipped:upcoming:0:-:-', 'delivered:upcoming:0:-:-'], { status: 'cancelled', at: T2 },
  ])
  const refused = trackStages(orderOf({ status: 'refused', history: history(['new', T0], ['confirmed', T1], ['preparing', T2], ['shipped', T3], ['refused', T4]) }))
  check('S09 refused after shipping: banner, shipping stays completed, delivery grey', [brief(refused), refused.banner], [
    ['received:done:1:' + T0 + ':-', 'confirmed:done:1:' + T1 + ':-', 'preparing:done:1:' + T3 + ':-', 'shipped:done:1:' + T3 + ':-', 'delivered:upcoming:0:-:-'], { status: 'refused', at: T4 },
  ])
  const old = trackStages(orderOf({ status: 'shipped', history: [] }))
  check('S10 order before the history: current stage only, no times, history note', [brief(old), old.historyNote], [
    ['received:upcoming:0:-:-', 'confirmed:upcoming:0:-:-', 'preparing:upcoming:0:-:-', 'shipped:current:1:-:-', 'delivered:upcoming:0:-:-'], TRACK_TEXT.historyMissing,
  ])
  const oldCancelled = trackStages(orderOf({ status: 'cancelled', history: history(['cancelled', T2]) }))
  check('S11 old cancelled order (no created event): banner without time, no current', [brief(oldCancelled).every((b) => b.includes(':upcoming:0:-:-')), oldCancelled.banner], [
    true, { status: 'cancelled', at: null },
  ])
  check('S12 preparing then cancelled: preparing not completed and not «skipped»', brief(trackStages(orderOf({ status: 'cancelled', history: history(['new', T0], ['confirmed', T1], ['preparing', T2], ['cancelled', T3]) })))[2],
    'preparing:upcoming:0:-:-')
  check('S13 segments are green only between two completed stages (skipped preparing · before the history · full path)', [
    trackSegments(skipped.stages), trackSegments(old.stages), trackSegments(delivered.stages), trackSegments(cancelled.stages),
  ], [[true, false, false, false], [false, false, false, false], [true, true, true, true], [true, false, false, false]])

  // ── الخطوة التالية (§٧) ──
  const fee = { confirmation_fee_piastres: 5000 }
  check('N01 – N08 next step for every status', [
    trackNextStep(orderOf({ status: 'new', history: history(['new', T0]) })),
    trackNextStep(orderOf({ status: 'new', history: history(['new', T0]), money: money(fee) })),
    trackNextStep(orderOf({ status: 'new', history: history(['new', T0]), money: money({ ...fee, paid_piastres: 5000 }) })),
    trackNextStep(orderOf()),
    trackNextStep(orderOf({ status: 'preparing' })),
    trackNextStep(orderOf({ status: 'shipped', money: money({ paid_piastres: 1000 }) })),
    trackNextStep(orderOf({ status: 'shipped', money: money({ paid_piastres: 191000 }) })),
    ['delivered', 'refused', 'cancelled'].map((status) => trackNextStep(orderOf({ status }))),
  ], [
    { text: 'سنتواصل معك لتأكيد الطلب', remainingPiastres: null },
    { text: 'يُؤكَّد الطلب بعد دفع المقدم', remainingPiastres: null },
    { text: 'تم استلام المقدم، وسنتواصل معك لتأكيد الطلب', remainingPiastres: null },
    { text: 'سيبدأ تجهيز طلبك', remainingPiastres: null },
    { text: 'جارٍ تجهيز طلبك، وسيُشحن بعد اكتمال التجهيز', remainingPiastres: null },
    { text: 'طلبك في الطريق — والمتبقي عند الاستلام', remainingPiastres: 190000 },
    { text: 'طلبك في الطريق', remainingPiastres: null },
    [null, null, null],
  ])

  // ── الموعد (§٨) ──
  const shipment = (over: Record<string, unknown>) => ({ carrier: 'بوسطة', tracking_number: null, tracking_url: null, shipped_on: null, expected_on: null, ...over })
  check('E01 confirmed delivery wins over the admin date', trackEta(orderOf({ confirmed_delivery: { date: '2026-11-03', period: 'evening' }, shipment: shipment({ expected_on: '2026-11-07' }) })),
    { kind: 'confirmed', line: 'موعد التسليم: 2026-11-03 · مساءً' })
  check('E02 admin expected date', trackEta(orderOf({ status: 'shipped', shipment: shipment({ expected_on: '2026-11-07' }) })), { kind: 'expected', line: 'الوصول المتوقع: 2026-11-07' })
  check('E03 actual shipping date + saved days (range)', trackEta(orderOf({ status: 'shipped', shipment: shipment({ shipped_on: '2026-10-20' }) })),
    { kind: 'range', line: 'الوصول المتوقع بين 2026-10-22 و2026-10-25' })
  check('E04 no shipped_on: the →shipped event day in Cairo + same min/max = one date',
    trackEta(orderOf({ status: 'shipped', history: history(['new', T0], ['shipped', '2026-10-20T23:30:00+00:00']), shipping: { method: 'express', days_min: 1, days_max: 1 } })),
    { kind: 'range', line: 'الوصول المتوقع: 2026-10-22' })
  check('E05 – E09 nothing to go on = «لم يتحدد بعد» (no days · old order · not shipped · preferred only)', [
    trackEta(orderOf({ status: 'shipped', shipment: shipment({ shipped_on: '2026-10-20' }), shipping: { method: 'standard', days_min: null, days_max: null } }))?.line,
    trackEta(orderOf({ status: 'shipped', shipment: shipment({ shipped_on: '2026-10-20' }), shipping: null }))?.line,
    trackEta(orderOf({ status: 'new', history: history(['new', T0]) }))?.line,
    trackEta(orderOf({ delivery: { kind: 'preferred', date: '2026-11-01', period: 'morning' } }))?.line,
  ], [TRACK_TEXT.etaNone, TRACK_TEXT.etaNone, TRACK_TEXT.etaNone, TRACK_TEXT.etaNone])
  check('E10 no ETA for delivered / cancelled / refused (exception documented in §17-1, pending owner approval)', ['delivered', 'cancelled', 'refused'].map((status) => trackEta(orderOf({ status, shipment: shipment({ expected_on: '2026-11-07' }) }))),
    [null, null, null])
  check('D01 calendar days and the Cairo day', [addCalendarDays('2026-10-30', 3), addCalendarDays('2026-12-31', 1), cairoDate('2026-10-20T23:30:00+00:00'), cairoDate('2026-10-20T10:00:00+00:00')],
    ['2026-11-02', '2027-01-01', '2026-10-21', '2026-10-20'])

  // ── الحساب (§٣) ──
  const full = trackMoneyLines(orderOf({
    shipping: { method: 'express', days_min: 1, days_max: 1 },
    money: money({ items_piastres: 180000, discount_piastres: 10000, shipping_piastres: 11000, installation_piastres: 7000, travel_piastres: 3000, total_piastres: 191000, confirmation_fee_piastres: 5000, paid_piastres: 5000 }),
  }))
  check('M01 active order: every charge line + paid · refunded · net · remaining as separate lines', full, {
    charges: [
      { label: 'الأصناف', amountPiastres: 180000, minus: false },
      { label: 'الخصم', amountPiastres: 10000, minus: true },
      { label: 'الشحن السريع', amountPiastres: 11000, minus: false },
      { label: 'التركيب', amountPiastres: 7000, minus: false },
      { label: 'انتقال الفني', amountPiastres: 3000, minus: false },
    ],
    totalPiastres: 191000,
    payments: [
      { label: 'المقدم المطلوب', amountPiastres: 5000, minus: false },
      { label: 'المدفوع', amountPiastres: 5000, minus: false },
      { label: 'المردود', amountPiastres: 0, minus: false },
      { label: 'الصافي', amountPiastres: 5000, minus: false },
      { label: 'المتبقي', amountPiastres: 186000, minus: false },
    ],
  })
  check('M02 cancelled and fully refunded: no «المتبقي», no amount due', trackMoneyLines(orderOf({ status: 'cancelled', money: money({ paid_piastres: 5000, refunded_piastres: 5000 }) })).payments, [
    { label: 'المدفوع', amountPiastres: 5000, minus: false },
    { label: 'المردود', amountPiastres: 5000, minus: false },
  ])
  check('M03 refused with net paid: «مبلغ مدفوع» only, never «المتبقي»', trackMoneyLines(orderOf({ status: 'refused', money: money({ paid_piastres: 5000 }) })).payments.map((l) => l.label),
    ['المدفوع', 'المردود', 'مبلغ مدفوع'])

  // ── الشحن · واتساب (§٩) ──
  check('H01 shipping label and days', [
    trackShippingView(orderOf()),
    trackShippingView(orderOf({ shipping: { method: 'express', days_min: 1, days_max: 1 } })),
    trackShippingView(orderOf({ shipping: { method: 'standard', days_min: null, days_max: null } })),
    trackShippingView(orderOf({ shipping: null })),
  ], [
    { label: 'شحن عادي', days: 'من 2 لـ 5 يوم من الشحن' },
    { label: 'شحن سريع', days: '1 يوم من الشحن' },
    { label: 'شحن عادي', days: null },
    null,
  ])
  check('W01 WhatsApp link with the order number · empty message · bad numbers hidden', [
    trackWhatsappHref('201234567890', 'مرحبًا', 'FLM-MRFVB3'),
    trackWhatsappHref(' 201234567890 ', '  ', 'FLM-MRFVB3'),
    ['', '201000', '+201234567890', '2012-3456-7890', '20123456789012345'].map((n) => trackWhatsappHref(n, 'x', 'FLM-MRFVB3')),
  ], [
    'https://wa.me/201234567890?text=' + encodeURIComponent('مرحبًا\nرقم الطلب: FLM-MRFVB3'),
    'https://wa.me/201234567890?text=' + encodeURIComponent('رقم الطلب: FLM-MRFVB3'),
    [null, null, null, null, null],
  ])

  check('K01 keep-number block: fixed /track link (no number in the URL) and the exact texts', [TRACK_PAGE_HREF, ORDER_NUMBER_KEEP], [
    '/track',
    { text: 'احتفظ برقم طلبك، وتقدر تتابع طلبك من «تتبّع طلبك»', copy: 'نسخ رقم الطلب', copied: 'اتنسخ رقم الطلب.', copyFailed: 'مقدرناش ننسخ الرقم. حدّده من فوق وانسخه بنفسك.' },
  ])

  return { passed, failures }
}
