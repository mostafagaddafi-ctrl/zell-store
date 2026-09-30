import 'server-only'

/**
 * أساسيات التحقق.
 *
 * قاعدة حاكمة: **ممنوع القص الصامت**. أي قيمة برّه الحد بترفض برسالة
 * عربية واضحة، ومابتتعدّلش لتبقى صالحة. تعديل صامت معناه إن الأدمن
 * حفظ حاجة وظهرت له حاجة تانية.
 *
 * كل الرسايل آمنة للعرض — مفيش اسم عمود ولا اسم قيد ولا أي تفصيلة
 * من الداتابيز.
 */

export type ValidationFailure = { ok: false; code: 'VALIDATION'; message: string }
export type Validated<T> = { ok: true; value: T } | ValidationFailure

export function invalid(message: string): ValidationFailure {
  return { ok: false, code: 'VALIDATION', message }
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** نص إلزامي بطول محدد. */
export function requiredText(value: unknown, label: string, min: number, max: number): Validated<string> {
  const text = asText(value)
  if (text === '') return invalid(label + ' مطلوب')
  if (text.length < min) return invalid(label + ' لازم يكون ' + String(min) + ' حروف على الأقل')
  if (text.length > max) return invalid(label + ' أطول من المسموح (' + String(max) + ' حرف)')
  return { ok: true, value: text }
}

/** نص اختياري. الفاضي بيتحوّل null — **مش** نص فاضي. */
export function optionalText(value: unknown, label: string, max: number): Validated<string | null> {
  const text = asText(value)
  if (text === '') return { ok: true, value: null }
  if (text.length > max) return invalid(label + ' أطول من المسموح (' + String(max) + ' حرف)')
  return { ok: true, value: text }
}

/** عدد صحيح منتهي. الكسور واللانهاية وNaN كلهم مرفوضين. */
export function wholeNumber(value: unknown, label: string): Validated<number> {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return invalid(label + ' لازم يكون رقم صحيح من غير كسور')
  }
  return { ok: true, value }
}

export function flag(value: unknown, label: string): Validated<boolean> {
  if (typeof value !== 'boolean') return invalid(label + ' لازم يكون صح أو غلط')
  return { ok: true, value }
}

/**
 * طابع زمني ISO صالح — إلزامي لأي تعديل على سجل موجود.
 * غيابه **مابيسمحش** بكتابة من غير تحقق؛ بيرفض VALIDATION.
 */
export function timestamp(value: unknown, label: string): Validated<string> {
  const text = asText(value)
  if (text === '') return invalid(label + ' ناقص. اعمل تحديث للصفحة وحاول تاني.')
  if (!Number.isFinite(Date.parse(text))) {
    return invalid(label + ' غير صالح. اعمل تحديث للصفحة وحاول تاني.')
  }
  return { ok: true, value: text }
}
