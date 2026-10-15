/**
 * TRACK-ORDER v2 W2-A — منطق عرض «تتبّع طلبك» (العقد docs/contracts/TRACK-ORDER-v2.md §٣ · §٤ · §٧ · §٨ · §٩ · §١٧-١).
 * منطق خالص: من غير server-only ولا شبكة ولا متغيرات بيئة (suite track).
 *
 *   • خط المراحل: استلام الطلب ← التأكيد ← التجهيز ← الشحن ← التسليم. المكتملة من history بس وبتوقيتها الفعلي،
 *     والحالية مميزة بالنص، والجاية رمادي. **مرحلة ماحصلتش عمرها ما تظهر مكتملة** (التجهيز المتخطّي يفضل رمادي).
 *   • الإلغاء ورفض الاستلام: بانر بالحالة ووقتها، واللي حصل فعلًا بيفضل مكتمل، والباقي رمادي.
 *   • طلب قبل السجل (مفيش حدث created): المرحلة الحالية بس من غير توقيت + سطر «سجل المراحل غير متاح لهذا الطلب».
 *   • الموعد بالأولوية: المؤكد ← المتوقع من الأدمن ← تاريخ الشحن الفعلي + المدة ← «موعد الوصول لم يتحدد بعد». مفيش أي تخمين.
 *   • المبالغ: المدفوع والمردود والصافي والمتبقي سطور منفصلة. الملغي والمرفوض: مفيش «المتبقي»، و«مبلغ مدفوع» لو الصافي > ٠.
 */

import { preferredDeliveryLine, type OrderStatus } from '@zell/core'
import type { TrackedHistoryEntry, TrackedOrder } from './trackOrder'

export const TRACK_TIME_ZONE = 'Africa/Cairo'

export type TrackStageKey = 'received' | 'confirmed' | 'preparing' | 'shipped' | 'delivered'

export const TRACK_STAGES: ReadonlyArray<{ key: TrackStageKey; label: string }> = [
  { key: 'received', label: 'استلام الطلب' },
  { key: 'confirmed', label: 'التأكيد' },
  { key: 'preparing', label: 'التجهيز' },
  { key: 'shipped', label: 'الشحن' },
  { key: 'delivered', label: 'التسليم' },
]

export const TRACK_TEXT = {
  current: 'الحالة الحالية',
  done: 'مكتملة',
  upcoming: 'لم تكتمل بعد',
  skipped: 'لم تُسجَّل',
  preparingNow: 'جارٍ التجهيز',
  preparingDone: 'تم التجهيز',
  historyMissing: 'سجل المراحل غير متاح لهذا الطلب',
  etaNone: 'موعد الوصول لم يتحدد بعد',
} as const

/** رابط صفحة التتبّع — ثابت ومن غير رقم الطلب (لا query ولا path). */
export const TRACK_PAGE_HREF = '/track'

/** «احتفظ برقم طلبك» في صفحة الإيصال (العقد §١٧-١). */
export const ORDER_NUMBER_KEEP = {
  text: 'احتفظ برقم طلبك، وتقدر تتابع طلبك من «تتبّع طلبك»',
  copy: 'نسخ رقم الطلب',
  copied: 'اتنسخ رقم الطلب.',
  copyFailed: 'مقدرناش ننسخ الرقم. حدّده من فوق وانسخه بنفسك.',
} as const

/**
 * state: 'done' مكتملة · 'current' المرحلة الحالية (مكتملة أو، في التجهيز، شغالة) · 'upcoming' رمادي.
 * completed = حصلت فعلًا (علامة صح ولون أخضر والخط لحدها ملوّن).
 */
export type TrackStage = {
  key: TrackStageKey
  label: string
  state: 'done' | 'current' | 'upcoming'
  completed: boolean
  at: string | null
  caption: string | null
}

export type TrackBanner = { status: 'cancelled' | 'refused'; at: string | null }

export type TrackStagesView = { stages: TrackStage[]; banner: TrackBanner | null; historyNote: string | null }

const STAGE_OF_STATUS: Record<OrderStatus, TrackStageKey | null> = {
  new: 'received',
  confirmed: 'confirmed',
  preparing: 'preparing',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: null,
  refused: null,
}

function firstAt(history: TrackedHistoryEntry[], status: OrderStatus): string | null {
  for (const entry of history) {
    if (entry.status === status) return entry.at
  }
  return null
}

function lastAt(history: TrackedHistoryEntry[], status: OrderStatus): string | null {
  let found: string | null = null
  for (const entry of history) {
    if (entry.status === status) found = entry.at
  }
  return found
}

/** أول حدث بالحالة دي بعد وقت معيّن (أو null). */
function firstAtAfter(history: TrackedHistoryEntry[], status: OrderStatus, after: string): string | null {
  const from = Date.parse(after)
  for (const entry of history) {
    if (entry.status === status && Date.parse(entry.at) >= from) return entry.at
  }
  return null
}

/** خط المراحل (العقد §٤ و§١٧-١). */
export function trackStages(order: TrackedOrder): TrackStagesView {
  const history = order.history
  const currentKey = STAGE_OF_STATUS[order.status]
  const banner: TrackBanner | null =
    order.status === 'cancelled' || order.status === 'refused' ? { status: order.status, at: lastAt(history, order.status) } : null

  // طلب قبل السجل: مفيش حدث created (حالته new). المرحلة الحالية بس من غير توقيت، والباقي رمادي.
  if (!history.some((entry) => entry.status === 'new')) {
    const stages = TRACK_STAGES.map((stage): TrackStage => {
      const isCurrent = stage.key === currentKey
      return {
        key: stage.key,
        label: isCurrent && stage.key === 'preparing' ? TRACK_TEXT.preparingNow : stage.label,
        state: isCurrent ? 'current' : 'upcoming',
        completed: isCurrent && stage.key !== 'preparing',
        at: null,
        caption: null,
      }
    })
    return { stages, banner: banner === null ? null : { status: banner.status, at: null }, historyNote: TRACK_TEXT.historyMissing }
  }

  const confirmedAt = firstAt(history, 'confirmed')
  const preparingAt = firstAt(history, 'preparing')
  const preparedAt = preparingAt === null ? null : firstAtAfter(history, 'shipped', preparingAt)
  const shippedAt = firstAt(history, 'shipped')
  const deliveredAt = firstAt(history, 'delivered')

  const base: Record<TrackStageKey, { completed: boolean; at: string | null; label: string }> = {
    received: { completed: true, at: order.createdAt, label: 'استلام الطلب' },
    confirmed: { completed: confirmedAt !== null, at: confirmedAt, label: 'التأكيد' },
    preparing:
      order.status === 'preparing'
        ? { completed: false, at: preparingAt, label: TRACK_TEXT.preparingNow }
        : preparedAt !== null
          ? { completed: true, at: preparedAt, label: TRACK_TEXT.preparingDone }
          : { completed: false, at: null, label: 'التجهيز' },
    shipped: { completed: shippedAt !== null, at: shippedAt, label: 'الشحن' },
    delivered: { completed: deliveredAt !== null, at: deliveredAt, label: 'التسليم' },
  }

  const stages = TRACK_STAGES.map((stage, index): TrackStage => {
    const info = base[stage.key]
    const isCurrent = stage.key === currentKey
    const laterCompleted = TRACK_STAGES.slice(index + 1).some((later) => base[later.key].completed)
    const skipped = !info.completed && !isCurrent && laterCompleted
    return {
      key: stage.key,
      label: info.label,
      state: isCurrent ? 'current' : info.completed ? 'done' : 'upcoming',
      completed: info.completed,
      at: info.completed || isCurrent ? info.at : null,
      caption: skipped ? TRACK_TEXT.skipped : null,
    }
  })
  return { stages, banner, historyNote: null }
}

/** وصلات الخط بين كل مرحلتين: خضرا بس لو المرحلتين مكتملين (مرحلة متخطّاة أو طلب قبل السجل = وصلة رمادي). */
export function trackSegments(stages: TrackStage[]): boolean[] {
  const out: boolean[] = []
  for (let i = 0; i + 1 < stages.length; i++) out.push((stages[i]?.completed ?? false) && (stages[i + 1]?.completed ?? false))
  return out
}

/** الخطوة التالية للعميل (العقد §٧). النصوص ثابتة في الكود. */
export function trackNextStep(order: TrackedOrder): { text: string; remainingPiastres: number | null } | null {
  const fee = order.money.confirmationFeePiastres
  const net = order.money.netPaidPiastres
  switch (order.status) {
    case 'new':
      if (fee === 0) return { text: 'سنتواصل معك لتأكيد الطلب', remainingPiastres: null }
      if (net < fee) return { text: 'يُؤكَّد الطلب بعد دفع المقدم', remainingPiastres: null }
      return { text: 'تم استلام المقدم، وسنتواصل معك لتأكيد الطلب', remainingPiastres: null }
    case 'confirmed':
      return { text: 'سيبدأ تجهيز طلبك', remainingPiastres: null }
    case 'preparing':
      return { text: 'جارٍ تجهيز طلبك، وسيُشحن بعد اكتمال التجهيز', remainingPiastres: null }
    case 'shipped':
      return order.money.remainingPiastres > 0
        ? { text: 'طلبك في الطريق — والمتبقي عند الاستلام', remainingPiastres: order.money.remainingPiastres }
        : { text: 'طلبك في الطريق', remainingPiastres: null }
    default:
      return null
  }
}

/** YYYY-MM-DD + أيام (تقويم بس، من غير توقيت). */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const ms = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) + days * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

/** يوم الحدث بتوقيت القاهرة (YYYY-MM-DD). */
export function cairoDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TRACK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(timestamp),
  )
}

function dateOnly(date: string): string {
  return preferredDeliveryLine({ date, period: null, note: null })
}

/**
 * الموعد (العقد §٨) — من غير أي تخمين. null للطلب اللي اتسلّم أو اتلغى أو اترفض (استثناء من §٨ متوثّق في §١٧-١،
 * بانتظار اعتماد المالك: مفيش وصول جاي في الحالات دي).
 * 'confirmed' المؤكد · 'expected' تاريخ الأدمن · 'range' الشحن الفعلي + المدة · 'none' لسه.
 */
export function trackEta(order: TrackedOrder): { kind: 'confirmed' | 'expected' | 'range' | 'none'; line: string } | null {
  if (order.status === 'delivered' || order.status === 'cancelled' || order.status === 'refused') return null
  if (order.confirmedDelivery !== null) {
    return {
      kind: 'confirmed',
      line: 'موعد التسليم: ' + preferredDeliveryLine({ date: order.confirmedDelivery.date, period: order.confirmedDelivery.period, note: null }),
    }
  }
  if (order.shipment !== null && order.shipment.expectedOn !== null) {
    return { kind: 'expected', line: 'الوصول المتوقع: ' + dateOnly(order.shipment.expectedOn) }
  }
  const shippedEvent = firstAt(order.history, 'shipped')
  const shippedOn = order.shipment?.shippedOn ?? (shippedEvent !== null ? cairoDate(shippedEvent) : null)
  const days = order.shipping
  if (shippedOn !== null && days !== null && days.daysMin !== null && days.daysMax !== null) {
    const from = addCalendarDays(shippedOn, days.daysMin)
    const to = addCalendarDays(shippedOn, days.daysMax)
    return {
      kind: 'range',
      line: from === to ? 'الوصول المتوقع: ' + dateOnly(from) : 'الوصول المتوقع بين ' + dateOnly(from) + ' و' + dateOnly(to),
    }
  }
  return { kind: 'none', line: TRACK_TEXT.etaNone }
}

export type TrackMoneyLine = { label: string; amountPiastres: number; minus: boolean }

/** سطور الحساب (العقد §٣). */
export function trackMoneyLines(order: TrackedOrder): { charges: TrackMoneyLine[]; totalPiastres: number; payments: TrackMoneyLine[] } {
  const m = order.money
  const charges: TrackMoneyLine[] = [{ label: 'الأصناف', amountPiastres: m.itemsPiastres, minus: false }]
  if (m.discountPiastres > 0) charges.push({ label: 'الخصم', amountPiastres: m.discountPiastres, minus: true })
  charges.push({ label: order.shipping?.method === 'express' ? 'الشحن السريع' : 'الشحن', amountPiastres: m.shippingPiastres, minus: false })
  if (m.installationPiastres > 0) charges.push({ label: 'التركيب', amountPiastres: m.installationPiastres, minus: false })
  if (m.travelPiastres > 0) charges.push({ label: 'انتقال الفني', amountPiastres: m.travelPiastres, minus: false })

  const payments: TrackMoneyLine[] = []
  if (order.status === 'cancelled' || order.status === 'refused') {
    payments.push({ label: 'المدفوع', amountPiastres: m.paidPiastres, minus: false })
    payments.push({ label: 'المردود', amountPiastres: m.refundedPiastres, minus: false })
    if (m.netPaidPiastres > 0) payments.push({ label: 'مبلغ مدفوع', amountPiastres: m.netPaidPiastres, minus: false })
    return { charges, totalPiastres: m.totalPiastres, payments }
  }
  if (m.confirmationFeePiastres > 0) payments.push({ label: 'المقدم المطلوب', amountPiastres: m.confirmationFeePiastres, minus: false })
  payments.push({ label: 'المدفوع', amountPiastres: m.paidPiastres, minus: false })
  payments.push({ label: 'المردود', amountPiastres: m.refundedPiastres, minus: false })
  payments.push({ label: 'الصافي', amountPiastres: m.netPaidPiastres, minus: false })
  payments.push({ label: 'المتبقي', amountPiastres: m.remainingPiastres, minus: false })
  return { charges, totalPiastres: m.totalPiastres, payments }
}

/** نوع الشحن ومدته من لقطة الطلب (null للطلب القديم). */
export function trackShippingView(order: TrackedOrder): { label: string; days: string | null } | null {
  const s = order.shipping
  if (s === null) return null
  const label = s.method === 'express' ? 'شحن سريع' : 'شحن عادي'
  if (s.daysMin === null || s.daysMax === null) return { label, days: null }
  const days = s.daysMin === s.daysMax ? String(s.daysMin) + ' يوم من الشحن' : 'من ' + String(s.daysMin) + ' لـ ' + String(s.daysMax) + ' يوم من الشحن'
  return { label, days }
}

const WHATSAPP_NUMBER_RE = /^\d{8,15}$/

/** زرار واتساب (العقد §٩): الرقم أرقام بس (٨–١٥)، والرسالة فيها رقم الطلب. رقم مش صالح = null (الزرار بيستخبّى). */
export function trackWhatsappHref(number: string, message: string, orderNumber: string): string | null {
  const digits = number.trim()
  if (!WHATSAPP_NUMBER_RE.test(digits)) return null
  const intro = message.trim()
  const text = (intro !== '' ? intro + '\n' : '') + 'رقم الطلب: ' + orderNumber
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text)
}

/** وقت الحدث للعرض بتوقيت القاهرة. */
export function trackTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('ar-EG', {
    timeZone: TRACK_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}
