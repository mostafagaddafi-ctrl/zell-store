import { orderErrorCode, orderFailureKind, type OrderFailureKind } from './cycle'

/**
 * 0021-D2 — إعداد موعد التسليم في صفحة الطلب (العقد docs/contracts/0021-D2.md §٢-٢ و§٢-٤). منطق خالص.
 *
 * القراية zell_delivery_settings_get (أي أدمن شغّال) والحفظ zell_delivery_settings_save (المالك بس) بجلسة المستخدم،
 * والقرار النهائي (الهوية · النسخة · التحقق 45430) في الداتابيز. التحقق هنا نفس قواعد الداتابيز بالحرف علشان رسالة أوضح.
 *
 * ⚠️ لو مفيش نص محفوظ، خانة النص بتبدأ بقيمة فعلية (DEFAULT_DELIVERY_NOTE) — **مش بتتحفظ غير بضغطة «حفظ» من المالك**.
 */

/** نفس حد الداتابيز (note_text ≤ 300 حرف بعد trim). */
export const DELIVERY_NOTE_MAX = 300
export const DEFAULT_DELIVERY_NOTE = 'هنتواصل معاك نحدد ميعاد التسليم'

export type DeliverySettings = {
  customerChoiceEnabled: boolean
  noteEnabled: boolean
  noteText: string | null
  updatedAt: string
}

/** اللي بيتبعت للحفظ (النص زي ما المالك كتبه؛ التطبيع هنا وفي الداتابيز). */
export type DeliverySettingsInput = {
  expectedUpdatedAt: string
  customerChoiceEnabled: boolean
  noteEnabled: boolean
  noteText: string
}

export type DeliverySettingsForm = {
  customerChoiceEnabled: boolean
  noteEnabled: boolean
  noteText: string
}

export const DELIVERY_SETTINGS_TEXT = {
  title: 'موعد التسليم في صفحة الطلب',
  intro: 'بتتحكم هنا في اختيار العميل لموعد التسليم في صفحة إتمام الطلب، وفي سطر بتكتبه للعميل.',
  choice: 'العميل يختار الموعد (يوم وفترة)',
  choiceHint: 'لو مقفول، العميل مش هيشوف أي اختيار للموعد، والطلب بيتعمل من غير موعد.',
  noteToggle: 'إظهار سطر للعميل',
  noteLabel: 'نص السطر',
  noteHint: 'مثلًا: «التوصيل عادة خلال 3 إلى 5 أيام». النص ده مش بيتحفظ غير لما تدوس «حفظ».',
  preview: 'العميل هيشوف:',
  previewChoiceOn: 'اختيار يوم وفترة (موعد مفضّل، وإحنا بنأكده بالتليفون).',
  previewChoiceOff: 'مفيش اختيار للموعد.',
  previewNoNote: 'من غير سطر.',
  ownerOnly: 'الحفظ للمالك بس.',
  unavailable: 'إعداد موعد التسليم مش متاح دلوقتي.',
  saved: 'اتحفظ.',
  save: 'حفظ',
  saving: 'جارِ الحفظ…',
} as const

export const DELIVERY_FIELD_MESSAGES: Readonly<Record<string, string>> = {
  customer_choice_enabled: 'اختار: العميل يختار الموعد أو لأ.',
  note_enabled: 'اختار: السطر ظاهر أو لأ.',
  note_text: 'نص السطر لازم يكون مكتوب لو السطر ظاهر، ومايزيدش عن 300 حرف.',
}

const WHITESPACE_EDGES = /^[ \t\r\n]+|[ \t\r\n]+$/g

/** نفس تطبيع الداتابيز: trim للمسافات والتاب والسطور، والفاضي = null (من غير NFC). */
export function normalizeDeliveryNote(text: string): string | null {
  const trimmed = text.replace(WHITESPACE_EDGES, '')
  return trimmed === '' ? null : trimmed
}

/** عدد الحروف زي char_length في Postgres (code points). */
export function noteLength(text: string): number {
  return Array.from(text).length
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** رد zell_delivery_settings_get أو _save. أي شكل تاني = null («مش متاح»). */
export function parseDeliverySettings(raw: unknown): DeliverySettings | null {
  if (!isObj(raw)) return null
  const choice = raw['customer_choice_enabled']
  const noteOn = raw['note_enabled']
  const text = raw['note_text']
  const at = raw['updated_at']
  if (typeof choice !== 'boolean' || typeof noteOn !== 'boolean' || typeof at !== 'string' || at === '') return null
  if (text !== null && typeof text !== 'string') return null
  return { customerChoiceEnabled: choice, noteEnabled: noteOn, noteText: text, updatedAt: at }
}

/** حالة الفورم أول ما تتفتح: من الداتابيز، والنص الافتراضي لو مفيش نص محفوظ (من غير أي حفظ). */
export function formOf(settings: DeliverySettings): DeliverySettingsForm {
  return {
    customerChoiceEnabled: settings.customerChoiceEnabled,
    noteEnabled: settings.noteEnabled,
    noteText: settings.noteText ?? DEFAULT_DELIVERY_NOTE,
  }
}

/** نفس قواعد الداتابيز (45430 note_text): الطول ≤ 300 بعد trim دايمًا، والسطر الظاهر لازم له نص. */
export function deliverySettingsIssue(form: DeliverySettingsForm): string | null {
  const note = normalizeDeliveryNote(form.noteText)
  if (note !== null && noteLength(note) > DELIVERY_NOTE_MAX) return DELIVERY_FIELD_MESSAGES['note_text'] as string
  if (form.noteEnabled && note === null) return DELIVERY_FIELD_MESSAGES['note_text'] as string
  return null
}

/** اللي بيتبعت للحفظ — بيتبني من الفورم بس وقت الضغط على «حفظ». */
export function inputOf(form: DeliverySettingsForm, settings: DeliverySettings): DeliverySettingsInput {
  return {
    expectedUpdatedAt: settings.updatedAt,
    customerChoiceEnabled: form.customerChoiceEnabled,
    noteEnabled: form.noteEnabled,
    noteText: form.noteText,
  }
}

/** المعاينة: زي ما العميل هيشوفها في Checkout. */
export function deliveryPreview(form: DeliverySettingsForm): { choice: string; note: string | null } {
  return {
    choice: form.customerChoiceEnabled ? DELIVERY_SETTINGS_TEXT.previewChoiceOn : DELIVERY_SETTINGS_TEXT.previewChoiceOff,
    note: form.noteEnabled ? normalizeDeliveryNote(form.noteText) : null,
  }
}

/** نوع الفشل: 45430 برسالة الحقل، والباقي من دورة الطلب (45400 · 45401 · 45402 · 45404). */
export function deliverySettingsFailureKind(error: unknown, httpStatus: number): OrderFailureKind {
  if (orderErrorCode(error) === '45430') {
    const detail = isObj(error) && typeof error['details'] === 'string' ? error['details'] : null
    const message = detail !== null ? DELIVERY_FIELD_MESSAGES[detail] : undefined
    return { kind: 'validation', message: message ?? (DELIVERY_FIELD_MESSAGES['note_text'] as string) }
  }
  return orderFailureKind(error, httpStatus)
}
