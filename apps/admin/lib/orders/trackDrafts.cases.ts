/**
 * TRACK-ORDER v2 W2-B — حالات إدارة النسخ في الكارتين (مراجعة #153: B1 إعادة المحاولة بنفس النية · B2 مفيش تبنّي صامت لنسخة
 * أحدث). منطق خالص — pnpm --filter @zell/admin cases، suite track-drafts. «الـ props» هنا = رد القراية بعد router.refresh.
 */

import {
  addIntentOf,
  adoptEditLatest,
  adoptShipmentLatest,
  boundSend,
  editDraftOf,
  editDraftStale,
  editIntentOf,
  editShipmentDraft,
  hideIntentOf,
  refreshBounds,
  shipmentDraftAfterSave,
  shipmentDraftDirty,
  shipmentDraftOf,
  shipmentDraftStale,
  shipmentIntentOf,
  syncEditDraft,
  syncShipmentDraft,
  type ShipmentIntent,
} from './trackDrafts'
import { shipmentPayload, type ShipmentView, type UpdatesView } from './trackUpdates'

export type TrackDraftsCaseFailure = { name: string; expected: string; actual: string }

const failures: TrackDraftsCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const V1 = '2026-10-15T05:00:00.111111+00:00'
const V2 = '2026-10-15T05:01:00.222222+00:00'
const V3 = '2026-10-15T05:02:00.333333+00:00'

function shipmentView(version: string | null, carrier = 'أرامكس'): ShipmentView {
  return {
    orderNumber: 'ZL-1001',
    status: 'shipped',
    editable: true,
    shipment: version === null ? null : { carrier, trackingNumber: null, trackingUrl: null, shippedOn: null, expectedOn: null, updatedAt: version },
  }
}

function updatesView(rowVersion: string, text: string, lastId = 7): UpdatesView {
  return {
    orderNumber: 'ZL-1001',
    status: 'confirmed',
    lastId,
    updates: [{ id: 7, text, hidden: false, edited: false, createdAt: V1, updatedAt: rowVersion }],
  }
}

export function runTrackDraftsCases(): { passed: number; failures: TrackDraftsCaseFailure[] } {
  // ── الشحنة: B2 ──
  const d0 = shipmentDraftOf(shipmentView(V1))
  check('D01 draft from V1: base V1, clean, not stale', [d0.base, shipmentDraftDirty(d0), shipmentDraftStale(d0, shipmentView(V1))], [V1, false, false])
  const d1 = editShipmentDraft(d0, 'carrier', 'بوسطة')
  const d1s = syncShipmentDraft(d1, shipmentView(V2, 'شركة شخص تاني'))
  check('D02 edited draft on V1 + refresh to V2 -> draft kept on V1 (no silent V2), stale, save intent still V1', [
    d1s.base, d1s.form.carrier, shipmentDraftStale(d1s, shipmentView(V2)), shipmentIntentOf(d1s).expectedUpdatedAt,
  ], [V1, 'بوسطة', true, V1])
  const c0 = syncShipmentDraft(d0, shipmentView(V2, 'شركة شخص تاني'))
  check('D03 untouched draft + refresh to V2 -> follows the server (nothing typed is lost)', [c0.base, c0.form.carrier, shipmentDraftDirty(c0)], [V2, 'شركة شخص تاني', false])
  const a1 = adoptShipmentLatest(d1s, shipmentView(V2, 'شركة شخص تاني'))
  check('D04 explicit adopt -> base V2, typed values kept, not stale, intent V2', [
    a1.base, a1.form.carrier, a1.baseForm.carrier, shipmentDraftStale(a1, shipmentView(V2)), shipmentIntentOf(a1).expectedUpdatedAt,
  ], [V2, 'بوسطة', 'شركة شخص تاني', false, V2])
  const x1 = shipmentDraftOf(shipmentView(V2, 'شركة شخص تاني'))
  check('D05 explicit discard -> the V2 values, clean', [x1.base, x1.form.carrier, shipmentDraftDirty(x1)], [V2, 'شركة شخص تاني', false])
  const n0 = editShipmentDraft(shipmentDraftOf(shipmentView(null)), 'carrier', 'أرامكس')
  const n1 = syncShipmentDraft(n0, shipmentView(V1, 'شركة شخص تاني'))
  check('D06 first save draft (base null) while someone else created V1 -> kept on null, stale', [n1.base, n1.form.carrier, shipmentDraftStale(n1, shipmentView(V1))], [null, 'أرامكس', true])

  // ── الشحنة: B1 ──
  const sent: Array<string | null> = []
  const intent = shipmentIntentOf(d1)
  const thunk = boundSend(intent, (i: ShipmentIntent) => {
    sent.push(i.expectedUpdatedAt + '|' + i.form.carrier)
    return i
  })
  thunk()
  // الـ props وصلت بـ V2 والمسودة اتبنّت V2 بإجراء صريح، والنية الأصلية اتعدّلت بالغلط — إعادة المحاولة لازم تفضل V1 بنفس المدخلات
  adoptShipmentLatest(d1, shipmentView(V2))
  intent.expectedUpdatedAt = V3
  intent.form.carrier = 'متغيّر'
  thunk()
  check('D07 retry sends the same intent (V1 + same form) even after props moved to V2', sent, [V1 + '|بوسطة', V1 + '|بوسطة'])
  const s1 = shipmentDraftAfterSave(shipmentIntentOf(d1), V3)
  check('D08 after a successful save: base = returned version, clean; refresh with that version keeps it', [
    s1.base, shipmentDraftDirty(s1), syncShipmentDraft(s1, shipmentView(V3, 'بوسطة')) === s1,
  ], [V3, false, true])

  // ── الرسالة: B2 ──
  const e0 = editDraftOf(updatesView(V1, 'النص الأول'), 7)
  if (e0 === null) throw new Error('e0')
  const e1 = { ...e0, text: 'نصي أنا' }
  const e1s = syncEditDraft(e1, updatesView(V2, 'نص شخص تاني'))
  check('D10 edit started on V1 + refresh to V2 -> my text kept on V1 (no silent V2), stale, intent V1', [
    e1s.base, e1s.text, editDraftStale(e1s, updatesView(V2, 'نص شخص تاني')), editIntentOf(e1s, e1s.text).expectedUpdatedAt,
  ], [V1, 'نصي أنا', true, V1])
  const e0s = syncEditDraft(e0, updatesView(V2, 'نص شخص تاني'))
  check('D11 untouched edit + refresh to V2 -> follows the server', [e0s.base, e0s.text], [V2, 'نص شخص تاني'])
  const e1a = adoptEditLatest(e1s, updatesView(V2, 'نص شخص تاني'))
  check('D12 explicit adopt -> base V2, my text kept, not stale', [e1a.base, e1a.baseText, e1a.text, editDraftStale(e1a, updatesView(V2, 'x'))], [V2, 'نص شخص تاني', 'نصي أنا', false])
  check('D13 hidden/shown by someone else also changes the version -> stale', editDraftStale(e1, { ...updatesView(V1, 'النص الأول'), updates: [{ id: 7, text: 'النص الأول', hidden: true, edited: false, createdAt: V1, updatedAt: V2 }] }), true)

  // ── الرسالة: B1 ──
  const editSent: string[] = []
  const editThunk = boundSend(editIntentOf(e1, 'نصي أنا'), (i) => editSent.push(i.id + '|' + i.expectedUpdatedAt + '|' + i.text))
  editThunk()
  syncEditDraft(e1, updatesView(V2, 'نص شخص تاني'))
  editThunk()
  check('D14 edit retry sends V1 + the same text after a refresh to V2', editSent, ['7|' + V1 + '|نصي أنا', '7|' + V1 + '|نصي أنا'])
  const hide = hideIntentOf(updatesView(V1, 'x'), 7, true)
  const hideSent: string[] = []
  const hideThunk = boundSend(hide, (i) => hideSent.push(String(i?.expectedUpdatedAt) + '|' + String(i?.hidden)))
  hideThunk()
  hideThunk()
  check('D15 hide intent = displayed version at click, retry identical; unknown row -> null', [hideSent, hideIntentOf(updatesView(V1, 'x'), 99, true)], [[V1 + '|true', V1 + '|true'], null])
  const addSent: string[] = []
  const addThunk = boundSend(addIntentOf(updatesView(V1, 'x', 7), 'رسالة'), (i) => addSent.push(String(i.expectedLastId) + '|' + i.text))
  addThunk()
  addThunk()
  check('D16 add intent = last_id at click, retry identical (second write = 45404, no duplicate)', addSent, ['7|رسالة', '7|رسالة'])

  // ── حدود «النهارده» وقت الحفظ ──
  const loaded = { orderDay: '2026-10-10', today: '2026-10-15' }
  const live = refreshBounds(loaded, Date.parse('2026-10-15T23:30:00Z'))
  check('D20 page loaded on 10-15, saving after Cairo midnight -> today 10-16; shipped 10-16 accepted only with refreshed bounds', [
    live,
    shipmentPayload({ carrier: 'أرامكس', trackingNumber: '', trackingUrl: '', shippedOn: '2026-10-16', expectedOn: '' }, live).ok,
    shipmentPayload({ carrier: 'أرامكس', trackingNumber: '', trackingUrl: '', shippedOn: '2026-10-16', expectedOn: '' }, loaded).ok,
    refreshBounds(loaded, Date.parse('2026-10-14T10:00:00Z')),
  ], [{ orderDay: '2026-10-10', today: '2026-10-16' }, true, false, loaded])
  return { passed, failures }
}
