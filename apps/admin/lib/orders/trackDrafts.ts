import { cairoToday } from './cycle'
import {
  shipmentFormOf,
  type CustomerUpdate,
  type ShipmentBounds,
  type ShipmentForm,
  type ShipmentView,
  type UpdatesView,
} from './trackUpdates'

/**
 * TRACK-ORDER v2 W2-B — إدارة النسخ في كارت «بيانات الشحنة» وكارت «رسائل للعميل» (مراجعة #153: B1 · B2). منطق خالص
 * (من غير server-only ولا أي استيراد قيمة برّه المجلد)، فحالات suite track-drafts بتشغّله فعليًا.
 *
 *   • المسودة ليها «نسخة البداية» (base) منفصلة عن أحدث نسخة معروضة من السيرفر. وصول props أحدث (router.refresh من أي
 *     إجراء في الصفحة) مابيغيّرش base بتاع مسودة متعدّلة: المسودة بتفضل، والكارت بيعرض إن النسخة اتغيّرت (stale) ويقفل الحفظ،
 *     ولحد ما المستخدم يختار بإجراء واضح: «اعتماد أحدث نسخة مع الاحتفاظ بما كتبته» أو «تجاهل ما كتبته». المسودة اللي
 *     ماتعدّلتش بتتبع السيرفر عادي (مفيش نص يضيع).
 *   • كل محاولة حفظ بتتثبّت كـ «نية» (النسخة + المدخلات) لحظة الضغط (boundSend بنسخة مستقلة)، وإعادة المحاولة بتبعت نفس
 *     النية بالحرف حتى لو الـ props اتحدّثت في النص. لو الكتابة الأولى حصلت = 45404 من غير تكرار ولا كتابة فوق تعديل حد تاني.
 *   • الإضافة: نسختها last_id المعروض لحظة الضغط (الإضافة مابتكتبش فوق حاجة؛ بعد التعارض القايمة بتتحدّث والمستخدم بيشوفها
 *     قبل ما يضغط تاني بنفسه). الإخفاء/الإظهار: نسخة الرسالة المعروضة لحظة الضغط.
 */

/** نية ثابتة: نسخة مستقلة من المدخلات وقت الإنشاء، وكل نداء (أول مرة أو إعادة المحاولة) بيبعتها هي بالحرف. */
export function boundSend<I, R>(intent: I, send: (intent: I) => R): () => R {
  const frozen = structuredClone(intent)
  return () => send(structuredClone(frozen))
}

/** حدود التواريخ وقت الحفظ: «النهارده» بتتحدّث لو الصفحة فضلت مفتوحة بعد منتصف الليل بتوقيت القاهرة. */
export function refreshBounds(bounds: ShipmentBounds, nowMs: number): ShipmentBounds {
  if (!Number.isFinite(nowMs)) return bounds
  const today = cairoToday(nowMs)
  return { orderDay: bounds.orderDay, today: today > bounds.today ? today : bounds.today }
}

// ── الشحنة ─────────────────────────────────────────────────────────────
export type ShipmentDraft = { base: string | null; baseForm: ShipmentForm; form: ShipmentForm }
export type ShipmentIntent = { expectedUpdatedAt: string | null; form: ShipmentForm }

const SHIPMENT_FIELDS: ReadonlyArray<keyof ShipmentForm> = ['carrier', 'trackingNumber', 'trackingUrl', 'shippedOn', 'expectedOn']

export function latestShipmentVersion(view: ShipmentView): string | null {
  return view.shipment === null ? null : view.shipment.updatedAt
}

export function shipmentDraftOf(view: ShipmentView | null): ShipmentDraft {
  const form = shipmentFormOf(view)
  return { base: view === null ? null : latestShipmentVersion(view), baseForm: form, form: { ...form } }
}

export function shipmentDraftDirty(draft: ShipmentDraft): boolean {
  return SHIPMENT_FIELDS.some((key) => draft.form[key] !== draft.baseForm[key])
}

/** أحدث نسخة معروضة غير نسخة بداية المسودة. */
export function shipmentDraftStale(draft: ShipmentDraft, view: ShipmentView | null): boolean {
  return view !== null && latestShipmentVersion(view) !== draft.base
}

/** وصول props جديدة: المسودة المتعدّلة بتفضل على نسختها، واللي ماتعدّلتش بتتبع السيرفر. */
export function syncShipmentDraft(draft: ShipmentDraft, view: ShipmentView | null): ShipmentDraft {
  if (view === null || !shipmentDraftStale(draft, view)) return draft
  return shipmentDraftDirty(draft) ? draft : shipmentDraftOf(view)
}

/** «اعتماد أحدث نسخة مع الاحتفاظ بما كتبته» (إجراء صريح). */
export function adoptShipmentLatest(draft: ShipmentDraft, view: ShipmentView): ShipmentDraft {
  return { base: latestShipmentVersion(view), baseForm: shipmentFormOf(view), form: { ...draft.form } }
}

export function editShipmentDraft(draft: ShipmentDraft, key: keyof ShipmentForm, value: string): ShipmentDraft {
  return { ...draft, form: { ...draft.form, [key]: value } }
}

export function shipmentIntentOf(draft: ShipmentDraft): ShipmentIntent {
  return { expectedUpdatedAt: draft.base, form: { ...draft.form } }
}

/** بعد الحفظ: نسخة البداية = النسخة اللي رجعت من الحفظ، والمسودة نظيفة. */
export function shipmentDraftAfterSave(intent: ShipmentIntent, version: string): ShipmentDraft {
  return { base: version, baseForm: { ...intent.form }, form: { ...intent.form } }
}

// ── رسائل العميل ───────────────────────────────────────────────────────
export type UpdateEditDraft = { id: number; base: string; baseText: string; text: string }
export type EditIntent = { id: number; expectedUpdatedAt: string; text: string }
export type HideIntent = { id: number; expectedUpdatedAt: string; hidden: boolean }
export type AddIntent = { expectedLastId: number | null; text: string }

export function updateRowOf(view: UpdatesView | null, id: number): CustomerUpdate | null {
  if (view === null) return null
  return view.updates.find((u) => u.id === id) ?? null
}

export function editDraftOf(view: UpdatesView | null, id: number): UpdateEditDraft | null {
  const row = updateRowOf(view, id)
  return row === null ? null : { id, base: row.updatedAt, baseText: row.text, text: row.text }
}

export function editDraftStale(draft: UpdateEditDraft, view: UpdatesView | null): boolean {
  const row = updateRowOf(view, draft.id)
  return row !== null && row.updatedAt !== draft.base
}

export function syncEditDraft(draft: UpdateEditDraft, view: UpdatesView | null): UpdateEditDraft {
  if (!editDraftStale(draft, view)) return draft
  if (draft.text !== draft.baseText) return draft
  return editDraftOf(view, draft.id) ?? draft
}

export function adoptEditLatest(draft: UpdateEditDraft, view: UpdatesView | null): UpdateEditDraft {
  const row = updateRowOf(view, draft.id)
  return row === null ? draft : { id: draft.id, base: row.updatedAt, baseText: row.text, text: draft.text }
}

export function editIntentOf(draft: UpdateEditDraft, text: string): EditIntent {
  return { id: draft.id, expectedUpdatedAt: draft.base, text }
}

export function hideIntentOf(view: UpdatesView | null, id: number, hidden: boolean): HideIntent | null {
  const row = updateRowOf(view, id)
  return row === null ? null : { id, expectedUpdatedAt: row.updatedAt, hidden }
}

export function addIntentOf(view: UpdatesView, text: string): AddIntent {
  return { expectedLastId: view.lastId, text }
}
