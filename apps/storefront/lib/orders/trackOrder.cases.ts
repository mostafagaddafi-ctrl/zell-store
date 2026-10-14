/**
 * TRACK-ORDER W2 — حالات «تتبّع طلبك» (pnpm --filter @zell/storefront cases، suite track).
 * العقد: docs/contracts/TRACK-ORDER.md §٣ (أمثلة التظبيط بالحرف) و§٤ (العرض وأسماء الحالات).
 */

import { CUSTOMER_STATUS_LABELS, ORDER_STATUSES, PREFERRED_DELIVERY_PENDING, STATUS_LABELS } from '@zell/core'
import {
  TRACK_INPUT_MAX,
  TRACK_NOT_FOUND_MESSAGE,
  customerStatusLabel,
  normalizeTrackCode,
  parseTrackedOrder,
  trackDeliveryView,
  trackItemSpec,
} from './trackOrder'

export type TrackCaseFailure = { name: string; expected: string; actual: string }

const failures: TrackCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const meterItem = { product_name_ar: 'فيلم عازل', length_cm: 300, width_cm: 100, quantity: 1, sale_unit: 'meter', line_total_piastres: 156000 }
const pieceItem = { product_name_ar: 'أداة تركيب', length_cm: null, width_cm: null, quantity: 2, sale_unit: 'piece', line_total_piastres: 30000 }
const sample = (over: Record<string, unknown> = {}) => ({
  order_number: 'FLM-MRFVB3',
  status: 'confirmed',
  created_at: '2026-10-13T10:00:00+00:00',
  total_piastres: 191000,
  items: [meterItem, pieceItem],
  delivery: { kind: 'preferred', date: '2026-11-01', period: 'morning' },
  ...over,
})

export function runTrackOrderCases(): { passed: number; failures: TrackCaseFailure[] } {
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

  // ── حارس الرد ──
  check('G01 full response -> only the known fields',
    parseTrackedOrder(sample()),
    {
      orderNumber: 'FLM-MRFVB3',
      status: 'confirmed',
      createdAt: '2026-10-13T10:00:00+00:00',
      totalPiastres: 191000,
      items: [
        { productName: 'فيلم عازل', saleUnit: 'meter', lengthCm: 300, widthCm: 100, quantity: 1, lineTotalPiastres: 156000 },
        { productName: 'أداة تركيب', saleUnit: 'piece', lengthCm: null, widthCm: null, quantity: 2, lineTotalPiastres: 30000 },
      ],
      delivery: { kind: 'preferred', date: '2026-11-01', period: 'morning' },
    })
  const leaked = parseTrackedOrder(sample({ customer_name: 'x', customer_phone: '01000000000', address: 'y', notes: 'z', coupon_code: 'C' }))
  check('G02 extra keys in the response never reach the result', leaked === null ? null : Object.keys(leaked).sort(),
    ['createdAt', 'delivery', 'items', 'orderNumber', 'status', 'totalPiastres'])
  check('G03 delivery null / no lines / meter without width',
    [parseTrackedOrder(sample({ delivery: null, items: [] }))?.delivery, parseTrackedOrder(sample({ items: [] }))?.items.length,
     parseTrackedOrder(sample({ items: [{ ...meterItem, width_cm: null }] }))?.items[0]?.widthCm],
    [null, 0, null])
  check('G04 every one of the seven statuses is accepted', ORDER_STATUSES.map((s) => parseTrackedOrder(sample({ status: s }))?.status ?? null), [...ORDER_STATUSES])
  check('G05 confirmed delivery with no period', parseTrackedOrder(sample({ delivery: { kind: 'confirmed', date: '2026-11-04', period: null } }))?.delivery,
    { kind: 'confirmed', date: '2026-11-04', period: null })
  check('G06 bad shapes -> null', [
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
  const withoutDelivery: Record<string, unknown> = { ...sample() }
  delete withoutDelivery['delivery']
  check('G07 missing delivery key -> null', parseTrackedOrder(withoutDelivery), null)

  // ── العرض ──
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

  return { passed, failures }
}
