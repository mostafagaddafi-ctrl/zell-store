/**
 * TRACK-ORDER v2 W2-B — حالات كارت «بيانات الشحنة» وكارت «رسائل للعميل» (منطق خالص — pnpm --filter @zell/admin cases،
 * suite track-updates). القواعد نفس دوال zell_shipment_* و zell_customer_update_* في 0021tr2 بالحرف.
 */

import {
  SHIPMENT_FIELD_MESSAGES,
  SHIPMENT_INVALID_MESSAGE,
  SHIPMENT_STATUS_MESSAGE,
  SHIPMENT_TEXT,
  UPDATES_TEXT,
  UPDATE_FIELD_MESSAGES,
  addDays,
  canAddUpdate,
  charCount,
  dbTrim,
  expectedMax,
  isCalendarDate,
  parseShipmentSaved,
  parseShipmentView,
  parseUpdatesView,
  parseUpdatesWritten,
  shipmentBounds,
  shipmentFailureKind,
  shipmentFormOf,
  shipmentPayload,
  updateFailureKind,
  updateText,
  updatesCountLine,
  type ShipmentBounds,
  type ShipmentForm,
} from './trackUpdates'

export type TrackUpdatesCaseFailure = { name: string; expected: string; actual: string }

const failures: TrackUpdatesCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const AT = '2026-10-15T01:29:04.123456+00:00'
const AT2 = '2026-10-15T02:00:00.5+00:00'
const SHIPMENT_RAW = {
  order_number: 'ZL-1001',
  status: 'shipped',
  editable: true,
  shipment: {
    carrier: 'أرامكس',
    tracking_number: 'AWB-1',
    tracking_url: 'https://track.example.com/1',
    shipped_on: '2026-10-14',
    expected_on: '2026-10-17',
    updated_at: AT,
  },
}
const U7 = { id: 7, text: 'تم شحن طلبك', hidden: false, edited: true, created_at: AT2, updated_at: AT2 }
const U3 = { id: 3, text: 'طلبك قيد التجهيز', hidden: true, edited: false, created_at: AT, updated_at: AT }
const UPDATES_RAW = { order_number: 'ZL-1001', status: 'confirmed', last_id: 7, updates: [U7, U3] }
const BOUNDS: ShipmentBounds = { orderDay: '2026-10-10', today: '2026-10-15' }

function form(patch: Partial<ShipmentForm> = {}): ShipmentForm {
  return { carrier: 'أرامكس', trackingNumber: '', trackingUrl: '', shippedOn: '', expectedOn: '', ...patch }
}

function field(result: ReturnType<typeof shipmentPayload>): string {
  return result.ok ? 'ok' : result.field
}

export function runTrackUpdatesCases(): { passed: number; failures: TrackUpdatesCaseFailure[] } {
  // ── قراية الشحنة ──
  check('T01 parse a shipment reply', parseShipmentView(SHIPMENT_RAW), {
    orderNumber: 'ZL-1001',
    status: 'shipped',
    editable: true,
    shipment: { carrier: 'أرامكس', trackingNumber: 'AWB-1', trackingUrl: 'https://track.example.com/1', shippedOn: '2026-10-14', expectedOn: '2026-10-17', updatedAt: AT },
  })
  check('T02 no shipment yet (null) · new order not editable', parseShipmentView({ order_number: 'ZL-1', status: 'new', editable: false, shipment: null }), {
    orderNumber: 'ZL-1', status: 'new', editable: false, shipment: null,
  })
  check('T03 optional fields null', parseShipmentView({ ...SHIPMENT_RAW, shipment: { ...SHIPMENT_RAW.shipment, tracking_number: null, tracking_url: null, shipped_on: null, expected_on: null } })?.shipment, {
    carrier: 'أرامكس', trackingNumber: null, trackingUrl: null, shippedOn: null, expectedOn: null, updatedAt: AT,
  })
  check('T04 bad shapes -> null (status · editable · date · stamp · missing key · empty carrier)', [
    parseShipmentView({ ...SHIPMENT_RAW, status: 'lost' }),
    parseShipmentView({ ...SHIPMENT_RAW, editable: 'yes' }),
    parseShipmentView({ ...SHIPMENT_RAW, shipment: { ...SHIPMENT_RAW.shipment, shipped_on: '2026-02-30' } }),
    parseShipmentView({ ...SHIPMENT_RAW, shipment: { ...SHIPMENT_RAW.shipment, updated_at: '' } }),
    parseShipmentView({ order_number: 'ZL-1', status: 'new', editable: false }),
    parseShipmentView({ ...SHIPMENT_RAW, shipment: { ...SHIPMENT_RAW.shipment, carrier: '' } }),
    parseShipmentView(null),
  ], [null, null, null, null, null, null, null])
  check('T05 save reply needs changed + a shipment', [
    parseShipmentSaved({ ...SHIPMENT_RAW, changed: false })?.changed,
    parseShipmentSaved(SHIPMENT_RAW),
    parseShipmentSaved({ ...SHIPMENT_RAW, shipment: null, changed: true }),
  ], [false, null, null])
  check('T06 form from the view (empty strings for nulls · empty form without a shipment)', [
    shipmentFormOf(parseShipmentView(SHIPMENT_RAW)),
    shipmentFormOf(null),
  ], [
    { carrier: 'أرامكس', trackingNumber: 'AWB-1', trackingUrl: 'https://track.example.com/1', shippedOn: '2026-10-14', expectedOn: '2026-10-17' },
    { carrier: '', trackingNumber: '', trackingUrl: '', shippedOn: '', expectedOn: '' },
  ])

  // ── تحقق الشحنة (نفس الداتابيز) ──
  check('T10 carrier only, trimmed (spaces/tabs/newlines), empty optional = null', shipmentPayload(form({ carrier: ' \t أرامكس \n', trackingNumber: '  ' }), BOUNDS), {
    ok: true, value: { carrier: 'أرامكس', trackingNumber: null, trackingUrl: null, shippedOn: null, expectedOn: null },
  })
  check('T11 carrier: empty · 61 code points · control char -> carrier; 60 emoji code points ok', [
    field(shipmentPayload(form({ carrier: '   ' }), BOUNDS)),
    field(shipmentPayload(form({ carrier: 'ش'.repeat(61) }), BOUNDS)),
    field(shipmentPayload(form({ carrier: 'شركة\u0007' }), BOUNDS)),
    field(shipmentPayload(form({ carrier: '\u{1F69A}'.repeat(60) }), BOUNDS)),
  ], ['carrier', 'carrier', 'carrier', 'ok'])
  check('T12 carrier NFC (decomposed = composed)', shipmentPayload(form({ carrier: 'Cafe\u0301' }), BOUNDS).ok && (shipmentPayload(form({ carrier: 'Cafe\u0301' }), BOUNDS) as { value: { carrier: string } }).value.carrier, 'Caf\u00e9')
  check('T13 tracking number: 61 -> tracking_number · control -> tracking_number · 60 ok', [
    field(shipmentPayload(form({ trackingNumber: '1'.repeat(61) }), BOUNDS)),
    field(shipmentPayload(form({ trackingNumber: 'A\u0000B' }), BOUNDS)),
    field(shipmentPayload(form({ trackingNumber: '1'.repeat(60) }), BOUNDS)),
  ], ['tracking_number', 'tracking_number', 'ok'])
  check('T14 tracking url: http · no dot · space · 301 chars · non-ascii -> tracking_url; https with port/path/query ok', [
    field(shipmentPayload(form({ trackingUrl: 'http://track.example.com' }), BOUNDS)),
    field(shipmentPayload(form({ trackingUrl: 'https://localhost/x' }), BOUNDS)),
    field(shipmentPayload(form({ trackingUrl: 'https://track.example.com/a b' }), BOUNDS)),
    field(shipmentPayload(form({ trackingUrl: 'https://t.example.com/' + 'a'.repeat(279) }), BOUNDS)),
    field(shipmentPayload(form({ trackingUrl: 'https://track.example.com/شحنة' }), BOUNDS)),
    field(shipmentPayload(form({ trackingUrl: 'https://track.example.com:8443/t?id=1#x' }), BOUNDS)),
    field(shipmentPayload(form({ trackingUrl: 'https://t.example.com/' + 'a'.repeat(278) }), BOUNDS)),
  ], ['tracking_url', 'tracking_url', 'tracking_url', 'tracking_url', 'tracking_url', 'ok', 'ok'])
  check('T15 shipped on: before the order day · after today · not a real date -> shipped_on; order day and today ok', [
    field(shipmentPayload(form({ shippedOn: '2026-10-09' }), BOUNDS)),
    field(shipmentPayload(form({ shippedOn: '2026-10-16' }), BOUNDS)),
    field(shipmentPayload(form({ shippedOn: '2026-02-29' }), BOUNDS)),
    field(shipmentPayload(form({ shippedOn: '2026-10-10' }), BOUNDS)),
    field(shipmentPayload(form({ shippedOn: '2026-10-15' }), BOUNDS)),
  ], ['shipped_on', 'shipped_on', 'shipped_on', 'ok', 'ok'])
  check('T16 expected on: before the order day · after today + 366 · before shipped -> expected_on; today + 366 and = shipped ok', [
    field(shipmentPayload(form({ expectedOn: '2026-10-09' }), BOUNDS)),
    field(shipmentPayload(form({ expectedOn: addDays('2026-10-15', 367) }), BOUNDS)),
    field(shipmentPayload(form({ shippedOn: '2026-10-14', expectedOn: '2026-10-13' }), BOUNDS)),
    field(shipmentPayload(form({ expectedOn: expectedMax(BOUNDS) }), BOUNDS)),
    field(shipmentPayload(form({ shippedOn: '2026-10-14', expectedOn: '2026-10-14' }), BOUNDS)),
  ], ['expected_on', 'expected_on', 'expected_on', 'ok', 'ok'])
  check('T17 server check (no bounds): shape only, expected >= shipped still checked, non-string -> field', [
    field(shipmentPayload(form({ shippedOn: '2020-01-01', expectedOn: '2030-01-01' }), null)),
    field(shipmentPayload(form({ shippedOn: '2026-10-14', expectedOn: '2026-10-13' }), null)),
    field(shipmentPayload({ ...form(), carrier: 5 } as unknown as ShipmentForm, null)),
    field(shipmentPayload({ ...form(), trackingUrl: null } as unknown as ShipmentForm, null)),
  ], ['ok', 'expected_on', 'carrier', 'tracking_url'])
  check('T18 bounds in Cairo (order 22:30 UTC = next day in Cairo) · 366 days ahead · leap day', [
    shipmentBounds('2026-10-09T22:30:00Z', Date.parse('2026-10-15T10:00:00Z')),
    shipmentBounds('bad', 0),
    expectedMax(BOUNDS),
    addDays('2028-02-28', 1),
    isCalendarDate('2028-02-29'),
  ], [{ orderDay: '2026-10-10', today: '2026-10-15' }, null, '2027-10-16', '2028-02-29', true])

  // ── رسائل العميل ──
  const view = parseUpdatesView(UPDATES_RAW)
  check('T20 parse the updates list (newest first, hidden kept, last_id = max id)', view, {
    orderNumber: 'ZL-1001',
    status: 'confirmed',
    lastId: 7,
    updates: [
      { id: 7, text: 'تم شحن طلبك', hidden: false, edited: true, createdAt: AT2, updatedAt: AT2 },
      { id: 3, text: 'طلبك قيد التجهيز', hidden: true, edited: false, createdAt: AT, updatedAt: AT },
    ],
  })
  check('T21 empty list needs last_id null', [
    parseUpdatesView({ order_number: 'ZL-1', status: 'new', last_id: null, updates: [] })?.lastId,
    parseUpdatesView({ order_number: 'ZL-1', status: 'new', last_id: 3, updates: [] }),
  ], [null, null])
  check('T22 bad shapes -> null (last_id not max · duplicate id · empty text · bad id · bad stamp)', [
    parseUpdatesView({ ...UPDATES_RAW, last_id: 3 }),
    parseUpdatesView({ ...UPDATES_RAW, updates: [U7, U7] }),
    parseUpdatesView({ ...UPDATES_RAW, last_id: 7, updates: [{ ...U7, text: '' }] }),
    parseUpdatesView({ ...UPDATES_RAW, last_id: 1.5, updates: [{ ...U7, id: 1.5 }] }),
    parseUpdatesView({ ...UPDATES_RAW, updates: [{ ...U7, updated_at: 'x' }] }),
  ], [null, null, null, null, null])
  check('T23 write reply: id in the list + changed; id missing -> null', [
    parseUpdatesWritten({ ...UPDATES_RAW, id: 7, changed: true })?.id,
    parseUpdatesWritten({ ...UPDATES_RAW, id: 9, changed: true }),
    parseUpdatesWritten({ ...UPDATES_RAW, id: 7 }),
  ], [7, null, null])
  check('T24 text: CRLF -> LF, trimmed, NFC; inner newline kept', updateText('\r\n  سطر أول\r\nسطر تاني  \n'), { ok: true, value: 'سطر أول\nسطر تاني' })
  check('T25 text: empty · 301 code points · tab inside · control char -> text; 300 emoji code points ok', [
    updateText('  \n ').ok,
    updateText('ب'.repeat(301)).ok,
    updateText('أ\tب').ok,
    updateText('أ\u001bب').ok,
    updateText('\u{1F4E6}'.repeat(300)).ok,
    updateText(42).ok,
  ], [false, false, false, false, true, false])
  check('T26 50 updates (hidden included) = add closed', [
    canAddUpdate({ orderNumber: 'ZL-1', status: 'new', lastId: null, updates: [] }),
    canAddUpdate({ orderNumber: 'ZL-1', status: 'new', lastId: 50, updates: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, text: 'x', hidden: i % 2 === 0, edited: false, createdAt: AT, updatedAt: AT })) }),
  ], [true, false])

  // ── أكواد الأخطاء ──
  check('T30 45433 by field; unknown field -> general message', [
    shipmentFailureKind({ code: '45433', details: 'tracking_url', message: 'ZELL_SHIPMENT_INVALID' }, 400),
    shipmentFailureKind({ code: '45433', details: 'zzz', message: 'ZELL_SHIPMENT_INVALID' }, 400),
  ], [{ kind: 'validation', message: SHIPMENT_FIELD_MESSAGES.tracking_url }, { kind: 'validation', message: SHIPMENT_INVALID_MESSAGE }])
  check('T31 shipment: 45410 status · 45404 conflict · 45403 not found · 45400 no session · 45401 forbidden · other -> internal', [
    shipmentFailureKind({ code: '45410', message: 'ZELL_ORD_NOT_ALLOWED_IN_STATUS' }, 400),
    shipmentFailureKind({ code: '45404', message: 'ZELL_ORD_CONFLICT' }, 409).kind,
    shipmentFailureKind({ code: '45403', message: 'ZELL_ORD_NOT_FOUND' }, 404).kind,
    shipmentFailureKind({ code: '45400', message: 'x' }, 401).kind,
    shipmentFailureKind({ code: '45401', message: 'x' }, 403).kind,
    shipmentFailureKind({ code: '22P02', message: 'x' }, 400).kind,
  ], [{ kind: 'validation', message: SHIPMENT_STATUS_MESSAGE }, 'conflict', 'not_found', 'unauthenticated', 'forbidden', 'internal'])
  check('T32 updates: 45434 text / hidden / count; 45404 conflict; 45403 not found', [
    updateFailureKind({ code: '45434', details: 'text', message: 'x' }, 400),
    updateFailureKind({ code: '45434', details: 'hidden', message: 'x' }, 400),
    updateFailureKind({ code: '45434', details: 'count', message: 'x' }, 400),
    updateFailureKind({ code: '45404', message: 'ZELL_ORD_CONFLICT' }, 409).kind,
    updateFailureKind({ code: '45403', message: 'ZELL_ORD_NOT_FOUND' }, 404).kind,
  ], [
    { kind: 'validation', message: UPDATE_FIELD_MESSAGES.text },
    { kind: 'validation', message: UPDATE_FIELD_MESSAGES.hidden },
    { kind: 'validation', message: UPDATE_FIELD_MESSAGES.count },
    'conflict',
    'not_found',
  ])

  // ── أدوات ونصوص ──
  check('T40 db trim keeps non-breaking space (like btrim with space/tab/CR/LF only) · code points', [dbTrim('\u00a0x \n'), charCount('\u{1F69A}a')], ['\u00a0x', 2])
  check('T41 formal texts present', [SHIPMENT_TEXT.title, UPDATES_TEXT.title, updatesCountLine(3)], ['بيانات الشحنة', 'رسائل للعميل', 'عدد الرسائل: 3 من 50 (شاملة المخفية).'])
  return { passed, failures }
}
