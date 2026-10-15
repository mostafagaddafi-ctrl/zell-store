/**
 * TRACK-ORDER — حالات «تتبّع طلبك» (pnpm --filter @zell/storefront cases، suite track).
 * العقود: docs/contracts/TRACK-ORDER.md §٣ (أمثلة التظبيط بالحرف) و§٤ · TRACK-ORDER-v2.md §٢ و§١٧-١ (حارس v2 بقيود الداتابيز).
 * الـ suite بتجمّع كمان trackView.cases.ts (العرض) وtrackLookup.cases.ts (الـ Server Action بنداءات وهمية).
 */

import { CUSTOMER_STATUS_LABELS, ORDER_STATUSES, PREFERRED_DELIVERY_PENDING, STATUS_LABELS } from '@zell/core'
import {
  TRACK_INPUT_MAX,
  TRACK_NOT_FOUND_MESSAGE,
  charCount,
  customerStatusLabel,
  normalizeTrackCode,
  parseTrackedOrder,
  trackDeliveryView,
  trackItemSpec,
} from './trackOrder'
import { T0, T1, history, meterItem, money, pieceItem, sampleResponse as sample } from './trackOrder.fixtures'
import { runTrackLookupCases } from './trackLookup.cases'
import { runTrackViewCases } from './trackView.cases'

export type TrackCaseFailure = { name: string; expected: string; actual: string }

const failures: TrackCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

function without(key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...sample() }
  delete copy[key]
  return copy
}

export async function runTrackOrderCases(): Promise<{ passed: number; failures: TrackCaseFailure[] }> {
  // ── التظبيط (أمثلة العقد §٣ بالحرف) ──
  check('N01 mrfvb3 · FLM-mrfvb3 · " flm mrfvb3 " · FLMMRFVB3 -> FLM-MRFVB3',
    ['mrfvb3', 'FLM-mrfvb3', ' flm mrfvb3 ', 'FLMMRFVB3'].map(normalizeTrackCode),
    ['FLM-MRFVB3', 'FLM-MRFVB3', 'FLM-MRFVB3', 'FLM-MRFVB3'])
  check('N02 FLMABC (length 6) -> FLM-FLMABC', normalizeTrackCode('FLMABC'), 'FLM-FLMABC')
  check('N03 flm-flmabc (length 9, starts with FLM) -> FLM-FLMABC', normalizeTrackCode('flm-flmabc'), 'FLM-FLMABC')
  check('N04 FLM ABC (6 after removing the space) -> FLM-FLMABC', normalizeTrackCode('FLM ABC'), 'FLM-FLMABC')
  check('N05 already normalized + tabs / new lines / several dashes', [normalizeTrackCode('FLM-MRFVB3'), normalizeTrackCode('\tFLM--MRF\nVB3 ')], ['FLM-MRFVB3', 'FLM-MRFVB3'])
  check('N06 O / 0 / I / 1 are not in the alphabet -> null (no call)',
    ['FLM-MRFVBO', 'FLM-MRFVB0', 'FLM-MRFVBI', 'FLM-MRFVB1', 'mrfvbo'].map(normalizeTrackCode), [null, null, null, null, null])
  check('N07 length not 6 or 9 -> null', ['MRFVB', 'MRFVB33', 'FLM-MRFVB', 'FLM-MRFVB33', 'FLM', 'FLM-', ''].map(normalizeTrackCode), [null, null, null, null, null, null, null])
  check('N08 length 9 not starting with FLM -> null', [normalizeTrackCode('ABCMRFVB3'), normalizeTrackCode('FLNMRFVB3')], [null, null])
  check('N09 other separators / symbols / Arabic digits / spaces only -> null',
    ['FLM_MRFVB3', 'FLM.MRFVB3', 'FLM-MRFVB%', '٢٣٤٥٦٧', '   ', 'FLM-MRF VB3!'].map(normalizeTrackCode), [null, null, null, null, null, null])
  check('N10 longer than the input limit -> null', normalizeTrackCode(' '.repeat(TRACK_INPUT_MAX) + 'MRFVB3'), null)
  check('N11 the code itself may start with FLM: FLMFLM -> FLM-FLMFLM, flm-flmflm -> FLM-FLMFLM',
    [normalizeTrackCode('FLMFLM'), normalizeTrackCode('flm-flmflm')], ['FLM-FLMFLM', 'FLM-FLMFLM'])

  // ── حارس الرد (v1 + v2) ──
  check('G01 full v2 response -> only the known fields, nested objects rebuilt', parseTrackedOrder(sample()), {
    orderNumber: 'FLM-MRFVB3',
    status: 'confirmed',
    createdAt: T0,
    totalPiastres: 191000,
    items: [
      { productName: 'فيلم عازل', saleUnit: 'meter', lengthCm: 300, widthCm: 100, quantity: 1, lineTotalPiastres: 156000 },
      { productName: 'أداة تركيب', saleUnit: 'piece', lengthCm: null, widthCm: null, quantity: 2, lineTotalPiastres: 30000 },
    ],
    delivery: { kind: 'preferred', date: '2026-11-01', period: 'morning' },
    customer: { name: 'عميل تجربة', phone: '01000000000', address: 'شارع التجربة ١٢', governorate: 'القاهرة', area: 'المعادي' },
    history: [{ status: 'new', at: T0 }, { status: 'confirmed', at: T1 }],
    money: {
      itemsPiastres: 186000, discountPiastres: 0, shippingPiastres: 5000, installationPiastres: 0, travelPiastres: 0, totalPiastres: 191000,
      confirmationFeePiastres: 0, paidPiastres: 0, refundedPiastres: 0, netPaidPiastres: 0, remainingPiastres: 191000,
    },
    shipping: { method: 'standard', daysMin: 2, daysMax: 5 },
    confirmedDelivery: null,
    shipment: null,
    updates: [],
  })
  const leaked = parseTrackedOrder(sample({
    customer_name: 'x', notes: 'z', internal_notes: 'SECRET', coupon_code: 'C',
    customer: { name: 'n', phone: 'p', address: 'a', governorate: 'g', area: null, notes: 'SECRET' },
    history: [{ status: 'new', at: T0, reason: 'SECRET', actor: 'SECRET' }],
    money: { ...money(), method_name: 'SECRET', reference: 'SECRET' },
    shipment: { carrier: 'بوسطة', tracking_number: null, tracking_url: null, shipped_on: null, expected_on: null, updated_by: 'SECRET' },
    updates: [{ id: 1, at: T1, text: 'وصل طلبك', edited: false, hidden: false, created_by: 'SECRET' }],
  }))
  check('G02 extra keys (top level and nested) never reach the result', leaked === null ? null : [
    Object.keys(leaked).sort(), Object.keys(leaked.customer).sort(), Object.keys(leaked.history[0] ?? {}).sort(),
    Object.keys(leaked.shipment ?? {}).sort(), Object.keys(leaked.updates[0] ?? {}).sort(), JSON.stringify(leaked).includes('SECRET'),
  ], [
    ['confirmedDelivery', 'createdAt', 'customer', 'delivery', 'history', 'items', 'money', 'orderNumber', 'shipment', 'shipping', 'status', 'totalPiastres', 'updates'],
    ['address', 'area', 'governorate', 'name', 'phone'], ['at', 'status'],
    ['carrier', 'expectedOn', 'shippedOn', 'trackingNumber', 'trackingUrl'], ['at', 'edited', 'id', 'text'], false,
  ])
  check('G03 delivery null / no lines / meter without width',
    [parseTrackedOrder(sample({ delivery: null, items: [] }))?.delivery, parseTrackedOrder(sample({ items: [] }))?.items.length,
     parseTrackedOrder(sample({ items: [{ ...meterItem, width_cm: null }] }))?.items[0]?.widthCm],
    [null, 0, null])
  check('G04 every one of the seven statuses is accepted', ORDER_STATUSES.map((s) => parseTrackedOrder(sample({ status: s }))?.status ?? null), [...ORDER_STATUSES])
  check('G05 confirmed delivery with no period', parseTrackedOrder(sample({ delivery: { kind: 'confirmed', date: '2026-11-04', period: null } }))?.delivery,
    { kind: 'confirmed', date: '2026-11-04', period: null })
  check('G06 bad v1 shapes -> null', [
    parseTrackedOrder(null),
    parseTrackedOrder([]),
    parseTrackedOrder('x'),
    parseTrackedOrder(sample({ status: 'unknown' })),
    parseTrackedOrder(sample({ order_number: 'FLM-mrfvb3' })),
    parseTrackedOrder(sample({ created_at: 'not a date' })),
    parseTrackedOrder(sample({ total_piastres: '191000' })),
    parseTrackedOrder(sample({ total_piastres: -1 })),
    parseTrackedOrder(sample({ items: 'x' })),
    parseTrackedOrder(sample({ items: [{ ...meterItem, length_cm: null }] })),
    parseTrackedOrder(sample({ items: [{ ...pieceItem, quantity: 0 }] })),
    parseTrackedOrder(sample({ items: [{ ...meterItem, sale_unit: 'box' }] })),
    parseTrackedOrder(sample({ items: [{ ...meterItem, line_total_piastres: 1.5 }] })),
    parseTrackedOrder(sample({ delivery: { kind: 'other', date: '2026-11-01', period: null } })),
    parseTrackedOrder(sample({ delivery: { kind: 'preferred', date: '01/11/2026', period: null } })),
    parseTrackedOrder(sample({ delivery: { kind: 'preferred', date: '2026-11-01', period: 'night' } })),
    parseTrackedOrder(sample({ delivery: 'x' })),
  ], new Array(17).fill(null))
  check('G07 missing delivery / shipping / confirmed_delivery / shipment key -> null',
    ['delivery', 'shipping', 'confirmed_delivery', 'shipment'].map((k) => parseTrackedOrder(without(k))), [null, null, null, null])
  check('G08 a v1-only response (no v2 keys) -> null', parseTrackedOrder({
    order_number: 'FLM-MRFVB3', status: 'new', created_at: T0, total_piastres: 1000, items: [], delivery: null,
  }), null)
  check('G09 bad v2 shapes -> null', [
    parseTrackedOrder(without('customer')),
    parseTrackedOrder(without('history')),
    parseTrackedOrder(without('money')),
    parseTrackedOrder(without('updates')),
    parseTrackedOrder(sample({ customer: { name: 'n', phone: 'p', address: 'a', governorate: 7, area: null } })),
    parseTrackedOrder(sample({ customer: { name: 'n', phone: 'p', address: 'a', governorate: 'g', area: 5 } })),
    parseTrackedOrder(sample({ history: [{ status: 'lost', at: T0 }] })),
    parseTrackedOrder(sample({ history: [{ status: 'new', at: 'yesterday' }] })),
    parseTrackedOrder(sample({ shipping: { method: 'rocket', days_min: 1, days_max: 2 } })),
    parseTrackedOrder(sample({ shipping: { method: 'express', days_min: 3, days_max: 1 } })),
    parseTrackedOrder(sample({ shipping: { method: 'express', days_min: -1, days_max: 1 } })),
    parseTrackedOrder(sample({ confirmed_delivery: { date: '3-11-2026', period: null } })),
    parseTrackedOrder(sample({ confirmed_delivery: { date: '2026-11-03', period: 'night' } })),
    parseTrackedOrder(sample({ shipment: { carrier: '', tracking_number: null, tracking_url: null, shipped_on: null, expected_on: null } })),
    parseTrackedOrder(sample({ shipment: { carrier: 'بوسطة', tracking_number: null, tracking_url: 'http://x.example/1', shipped_on: null, expected_on: null } })),
    parseTrackedOrder(sample({ shipment: { carrier: 'بوسطة', tracking_number: null, tracking_url: 'javascript:alert(1)', shipped_on: null, expected_on: null } })),
    parseTrackedOrder(sample({ shipment: { carrier: 'بوسطة', tracking_number: null, tracking_url: null, shipped_on: '20/10/2026', expected_on: null } })),
    parseTrackedOrder(sample({ updates: [{ id: 1, at: T1, text: '   ', edited: false }] })),
    parseTrackedOrder(sample({ updates: [{ id: 0, at: T1, text: 'x', edited: false }] })),
    parseTrackedOrder(sample({ updates: [{ id: 1, at: T1, text: 'x', edited: 'no' }] })),
    parseTrackedOrder(sample({ updates: [{ id: 1, at: T1, text: 'x'.repeat(301), edited: false }] })),
  ], new Array(21).fill(null))
  check('G10 inconsistent money -> null (net = paid − refunded · remaining = total − net · same total as v1)', [
    parseTrackedOrder(sample({ money: money({ paid_piastres: 5000, net_paid_piastres: 4000 }) })),
    parseTrackedOrder(sample({ money: money({ remaining_piastres: 1 }) })),
    parseTrackedOrder(sample({ money: money({ total_piastres: 190000 }) })),
    parseTrackedOrder(sample({ money: money({ shipping_piastres: 1.5 }) })),
    parseTrackedOrder(sample({ money: { ...money(), items_piastres: undefined } })),
  ], [null, null, null, null, null])
  check('G11 empty area -> null · empty tracking number -> null', [
    parseTrackedOrder(sample({ customer: { name: 'n', phone: 'p', address: 'a', governorate: 'g', area: '' } }))?.customer.area,
    parseTrackedOrder(sample({ shipment: { carrier: 'بوسطة', tracking_number: '', tracking_url: null, shipped_on: null, expected_on: null } }))?.shipment?.trackingNumber,
  ], [null, null])
  check('G13 net above the total -> null · paid above the total after a refund and re-payment is fine (net is what is bounded)', [
    parseTrackedOrder(sample({ money: money({ paid_piastres: 200000 }) })),
    parseTrackedOrder(sample({ money: money({ paid_piastres: 200000, refunded_piastres: 20000 }) }))?.money.netPaidPiastres,
    parseTrackedOrder(sample({ money: money({ paid_piastres: 191000 }) }))?.money.remainingPiastres,
  ], [null, 180000, 0])
  check('G14 money equation and bounds: total breakdown · discount ≤ items · deposit ≤ total', [
    parseTrackedOrder(sample({ money: money({ shipping_piastres: 6000 }) })),
    parseTrackedOrder(sample({ money: money({ items_piastres: 1000, discount_piastres: 2000, shipping_piastres: 192000 }) })),
    parseTrackedOrder(sample({ money: money({ confirmation_fee_piastres: 191001 }) })),
    parseTrackedOrder(sample({ money: money({ items_piastres: 190000, discount_piastres: 4000, shipping_piastres: 5000 }) }))?.money.discountPiastres,
  ], [null, null, null, 4000])
  check('G15 real calendar dates and safe integers only', [
    parseTrackedOrder(sample({ delivery: { kind: 'preferred', date: '2026-02-30', period: null } })),
    parseTrackedOrder(sample({ delivery: { kind: 'preferred', date: '2026-13-01', period: null } })),
    parseTrackedOrder(sample({ confirmed_delivery: { date: '2026-02-29', period: null } })),
    parseTrackedOrder(sample({ shipment: { carrier: 'بوسطة', tracking_number: null, tracking_url: null, shipped_on: '2026-04-31', expected_on: null } })),
    parseTrackedOrder(sample({ total_piastres: 1e100 })),
    parseTrackedOrder(sample({ updates: [{ id: 2 ** 53, at: T1, text: 'x', edited: false }] })),
    parseTrackedOrder(sample({ items: [{ ...meterItem, line_total_piastres: 2 ** 53 }] })),
    parseTrackedOrder(sample({ confirmed_delivery: { date: '2028-02-29', period: null } }))?.confirmedDelivery?.date,
  ], [null, null, null, null, null, null, null, '2028-02-29'])
  const ship = (over: Record<string, unknown>) => ({ carrier: 'بوسطة', tracking_number: null, tracking_url: null, shipped_on: null, expected_on: null, ...over })
  check('G16 shipping days complete or empty · valid https link · expected ≥ shipped', [
    parseTrackedOrder(sample({ shipping: { method: 'standard', days_min: 2, days_max: null } })),
    parseTrackedOrder(sample({ shipping: { method: 'express', days_min: null, days_max: 1 } })),
    parseTrackedOrder(sample({ shipment: ship({ tracking_url: 'https://' }) })),
    parseTrackedOrder(sample({ shipment: ship({ tracking_url: 'https://localhost/track' }) })),
    parseTrackedOrder(sample({ shipment: ship({ tracking_url: 'https://bosta .co/x' }) })),
    parseTrackedOrder(sample({ shipment: ship({ shipped_on: '2026-10-20', expected_on: '2026-10-19' }) })),
    parseTrackedOrder(sample({ shipment: ship({ tracking_url: 'https://bosta.co/track?id=1' }) }))?.shipment?.trackingUrl,
    parseTrackedOrder(sample({ shipment: ship({ shipped_on: '2026-10-20', expected_on: '2026-10-20' }) }))?.shipment?.expectedOn,
  ], [null, null, null, null, null, null, 'https://bosta.co/track?id=1', '2026-10-20'])
  const emoji = '\u{1F600}'
  check('G17 lengths counted like char_length (code points): 300 / 60 accepted, 301 / 61 rejected', [
    parseTrackedOrder(sample({ updates: [{ id: 1, at: T1, text: emoji.repeat(300), edited: false }] })) !== null,
    parseTrackedOrder(sample({ updates: [{ id: 1, at: T1, text: emoji.repeat(301), edited: false }] })) !== null,
    parseTrackedOrder(sample({ shipment: ship({ carrier: emoji.repeat(60) }) })) !== null,
    parseTrackedOrder(sample({ shipment: ship({ carrier: emoji.repeat(61) }) })) !== null,
    parseTrackedOrder(sample({ shipment: ship({ tracking_number: emoji.repeat(60) }) })) !== null,
    parseTrackedOrder(sample({ shipment: ship({ tracking_number: emoji.repeat(61) }) })) !== null,
    charCount(emoji.repeat(300)),
  ], [true, false, true, false, true, false, 300])
  check('G12 history kept in order (created first)', parseTrackedOrder(sample({ history: history(['new', T0], ['confirmed', T1], ['cancelled', '2026-10-14T00:00:00+00:00']) }))?.history.map((h) => h.status),
    ['new', 'confirmed', 'cancelled'])

  // ── العرض (v1) ──
  check('V01 the seven customer labels (contract §4, exactly)', ORDER_STATUSES.map((s) => customerStatusLabel(s)), [
    'استلمنا طلبك', 'طلبك اتأكد', 'بنجهّز طلبك', 'طلبك في الطريق', 'اتسلّم', 'ماتمّش الاستلام', 'الطلب اتلغى',
  ])
  check('V02 every status has a non-empty customer label', ORDER_STATUSES.every((s) => (CUSTOMER_STATUS_LABELS[s] ?? '').length > 0), true)
  check('V03 the admin STATUS_LABELS are unchanged', ORDER_STATUSES.map((s) => STATUS_LABELS[s]), [
    'جديد', 'مؤكد', 'بيتجهّز', 'تم الشحن', 'تم التسليم', 'رفض الاستلام', 'ملغي',
  ])
  check('V04 delivery: confirmed · preferred (pending note, like the receipt) · none', [
    trackDeliveryView({ kind: 'confirmed', date: '2026-11-03', period: 'evening' }),
    trackDeliveryView({ kind: 'preferred', date: '2026-11-01', period: 'morning' }),
    trackDeliveryView({ kind: 'preferred', date: '2026-11-05', period: null }),
    trackDeliveryView(null),
  ], [
    { line: 'موعد التسليم: 2026-11-03 · مساءً', note: null },
    { line: '2026-11-01 · صباحًا', note: PREFERRED_DELIVERY_PENDING },
    { line: '2026-11-05', note: PREFERRED_DELIVERY_PENDING },
    null,
  ])
  check('V05 line spec: meter with width · meter without width · piece', [
    trackItemSpec({ productName: 'a', saleUnit: 'meter', lengthCm: 300, widthCm: 100, quantity: 1, lineTotalPiastres: 1 }),
    trackItemSpec({ productName: 'a', saleUnit: 'meter', lengthCm: 250, widthCm: null, quantity: 1, lineTotalPiastres: 1 }),
    trackItemSpec({ productName: 'a', saleUnit: 'piece', lengthCm: null, widthCm: null, quantity: 2, lineTotalPiastres: 1 }),
  ], ['3 متر · عرض 1 متر', '2.5 متر', 'الكمية 2'])
  check('V06 the single not-found message (contract §4)', TRACK_NOT_FOUND_MESSAGE, 'مالقيناش طلب بالكود ده. اتأكد منه وجرّب تاني.')

  const view = runTrackViewCases()
  const lookup = await runTrackLookupCases()
  return { passed: passed + view.passed + lookup.passed, failures: [...failures, ...view.failures, ...lookup.failures] }
}
