/**
 * 0021-D — موعد التسليم المفضّل في Checkout: الشكل والتحقق المبدئي والنص (المتجر واللوحة وتيليجرام).
 *
 *   • الداتابيز هي الحكم (zell_create_order · 45415): التاريخ من النهارده بتوقيت القاهرة لحد 60 يوم، والفترة من التلاتة،
 *     والملاحظة ≤ 200 حرف. الموعد لقطة على الطلب، منفصلة عن الموعد اللي الأدمن بيأكده، ومابيغيّرش أي مبلغ.
 *   • أوقات الفترات (من/لـ) من الداتابيز (order_delivery_periods عن طريق zell_checkout_delivery_periods)، مش هنا.
 *     هنا أسماء الفترات التلاتة الثابتة بس.
 */

export const DELIVERY_PERIODS = ['morning', 'noon', 'evening'] as const
export type DeliveryPeriod = (typeof DELIVERY_PERIODS)[number]

export const DELIVERY_PERIOD_LABELS: Record<DeliveryPeriod, string> = {
  morning: 'صباحًا',
  noon: 'ظهرًا',
  evening: 'مساءً',
}

export const PREFERRED_DELIVERY_MAX_DAYS = 60
export const PREFERRED_DELIVERY_NOTE_MAX = 200
export const PREFERRED_DELIVERY_PENDING = 'موعد مفضل — بانتظار التأكيد'

export type PreferredDelivery = { date: string; period: DeliveryPeriod | null; note: string | null }
export type PreferredDeliveryDraft = { date: string; period: string; note: string }
export type DeliveryPeriodTime = { period: DeliveryPeriod; startsAt: string; endsAt: string }

export const EMPTY_PREFERRED_DELIVERY: PreferredDeliveryDraft = { date: '', period: '', note: '' }

export function isDeliveryPeriod(value: unknown): value is DeliveryPeriod {
  return typeof value === 'string' && (DELIVERY_PERIODS as readonly string[]).includes(value)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** تاريخ النهارده بتوقيت القاهرة YYYY-MM-DD. */
export function cairoDateIso(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10)
}

/** حقل الطلب من المتصفح (السيرفر): غايب أو null = مفيش موعد. أي شكل تاني غلط = ok: false. */
export function parsePreferredDeliveryField(raw: unknown): { ok: true; value: PreferredDelivery | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some((key) => key !== 'date' && key !== 'period' && key !== 'note')) return { ok: false }
  if (typeof v['date'] !== 'string' || !isCalendarDate(v['date'])) return { ok: false }
  const rawPeriod = v['period']
  let period: DeliveryPeriod | null = null
  if (rawPeriod !== undefined && rawPeriod !== null && rawPeriod !== '') {
    if (!isDeliveryPeriod(rawPeriod)) return { ok: false }
    period = rawPeriod
  }
  const rawNote = v['note']
  let note: string | null = null
  if (rawNote !== undefined && rawNote !== null) {
    if (typeof rawNote !== 'string') return { ok: false }
    const trimmed = rawNote.normalize('NFC').trim()
    if (trimmed.length > PREFERRED_DELIVERY_NOTE_MAX) return { ok: false }
    note = trimmed === '' ? null : trimmed
  }
  return { ok: true, value: { date: v['date'], period, note } }
}

/** تحقق الفورم قبل الإرسال بنفس حدود الداتابيز. null = سليم (أو من غير موعد). */
export function preferredDeliveryIssue(draft: PreferredDeliveryDraft, todayIso: string): string | null {
  const date = draft.date.trim()
  const note = draft.note.trim()
  if (date === '') {
    return draft.period !== '' || note !== '' ? 'اختار تاريخ الموعد الأول، أو امسح الفترة والملاحظة.' : null
  }
  if (!isCalendarDate(date)) return 'تاريخ الموعد مش صحيح.'
  if (date < todayIso) return 'اختار تاريخ من النهارده أو بعده.'
  if (date > addDaysIso(todayIso, PREFERRED_DELIVERY_MAX_DAYS)) return 'الموعد لازم يكون خلال ' + String(PREFERRED_DELIVERY_MAX_DAYS) + ' يوم.'
  if (draft.period !== '' && !isDeliveryPeriod(draft.period)) return 'اختار فترة من الموجودين.'
  if (note.length > PREFERRED_DELIVERY_NOTE_MAX) return 'ملاحظة الموعد أطول من ' + String(PREFERRED_DELIVERY_NOTE_MAX) + ' حرف.'
  return null
}

/** الحقل في body الطلب: من غير تاريخ = مفيش حقل خالص (الـbody القديم بالحرف). */
export function preferredPayloadField(draft: PreferredDeliveryDraft): { preferredDelivery: PreferredDelivery } | Record<string, never> {
  const date = draft.date.trim()
  if (date === '') return {}
  const note = draft.note.normalize('NFC').trim()
  return {
    preferredDelivery: {
      date,
      period: isDeliveryPeriod(draft.period) ? draft.period : null,
      note: note === '' ? null : note,
    },
  }
}

/** لقطة الإيصال / الصف: شكل سليم بس، وإلا null (العرض مابيقعش). */
export function parsePreferredDeliverySnapshot(raw: unknown): PreferredDelivery | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (typeof v['date'] !== 'string' || !isCalendarDate(v['date'])) return null
  return {
    date: v['date'],
    period: isDeliveryPeriod(v['period']) ? v['period'] : null,
    note: typeof v['note'] === 'string' && v['note'] !== '' ? v['note'] : null,
  }
}

/** «2026-01-20 · ظهرًا» (من غير فترة: التاريخ بس). */
export function preferredDeliveryLine(value: PreferredDelivery): string {
  return value.date + (value.period !== null ? ' · ' + DELIVERY_PERIOD_LABELS[value.period] : '')
}

/** أوقات الفترات من zell_checkout_delivery_periods. شكل غلط = null. */
export function parsePeriodTimes(raw: unknown): DeliveryPeriodTime[] | null {
  if (!Array.isArray(raw)) return null
  const out: DeliveryPeriodTime[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) return null
    const r = row as Record<string, unknown>
    if (!isDeliveryPeriod(r['period']) || typeof r['starts_at'] !== 'string' || typeof r['ends_at'] !== 'string') return null
    out.push({ period: r['period'], startsAt: r['starts_at'], endsAt: r['ends_at'] })
  }
  return out
}
