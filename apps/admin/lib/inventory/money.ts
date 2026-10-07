/**
 * تحويل الفلوس والأطوال والكميات من النص — منطق خالص، من غير float خالص.
 *
 *   • الفلوس: جنيه بحد أقصى منزلتين عشريتين → قروش صحيحة (bigint في الداتابيز).
 *   • الطول: **متر** بحد أقصى منزلتين → سنتيمتر صحيح (قرار المراجعة). العرض «27.50 متر — 2750 سم».
 *   • الكمية: عدد صحيح.
 *
 * التحويل بيتم على الأجزاء النصية (الصحيح والكسر) مش على Number(text) * 100، فمفيش أخطاء تقريب.
 * الأرقام **إنجليزية بس** (0–9) زي الداتابيز — مفيش تحويل صامت لأرقام عربية (قرار المالك).
 * الفاصلة العشرية نقطة «.» بس.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

/** أقصى مبلغ في 0020 (سطر، مصروف، خصم): 10,000,000,000 قرش. */
export const MAX_AMOUNT_PIASTRES = 10_000_000_000
/** أقصى طول لفّة في 0020: 100,000 سم = 1000 متر. */
export const MAX_ROLL_CM = 100_000
/** أقصى كمية دفعة في 0020. */
export const MAX_QUANTITY = 1_000_000

const DECIMAL = /^([0-9]{1,12})(?:\.([0-9]{1,2}))?$/
const INTEGER = /^[0-9]{1,9}$/
const NON_LATIN_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/

export const LATIN_DIGITS_MESSAGE = 'اكتب الأرقام بالإنجليزي (0–9).'

function clean(text: string): string {
  return text.trim()
}

/** نص عشري بحد أقصى منزلتين → وحدات صغرى (×100) من الأجزاء النصية. */
function decimalToHundredths(text: string): number | null {
  const match = DECIMAL.exec(text)
  if (!match) return null
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').padEnd(2, '0')
  const value = Number(whole) * 100 + Number(fraction)
  return Number.isSafeInteger(value) ? value : null
}

function label(name: string): string {
  return name === '' ? '' : name + ': '
}

/**
 * جنيه → قروش. allowZero للسطر (تكلفة صفر مسموحة بسبب) والخصم.
 * الفاضي: required = false → 0 (للخصم الاختياري).
 */
export function parsePounds(
  text: string,
  options: { name: string; allowZero: boolean; required: boolean },
): Parsed<number> {
  const value = clean(text)
  if (value === '') {
    if (!options.required) return { ok: true, value: 0 }
    return { ok: false, message: label(options.name) + 'المبلغ مطلوب.' }
  }
  if (NON_LATIN_DIGITS.test(value)) return { ok: false, message: label(options.name) + LATIN_DIGITS_MESSAGE }
  const piastres = decimalToHundredths(value)
  if (piastres === null) {
    return { ok: false, message: label(options.name) + 'المبلغ لازم يكون رقم بالجنيه وبحد أقصى قرشين (مثال 1250.50).' }
  }
  if (piastres > MAX_AMOUNT_PIASTRES) {
    return { ok: false, message: label(options.name) + 'المبلغ أكبر من المسموح.' }
  }
  if (piastres === 0 && !options.allowZero) {
    return { ok: false, message: label(options.name) + 'المبلغ لازم يكون أكبر من صفر.' }
  }
  return { ok: true, value: piastres }
}

/** متر (منزلتين بحد أقصى) → سم صحيح، من 1 سم لـ 1000 متر. */
export function parseMeters(text: string, name: string): Parsed<number> {
  const value = clean(text)
  if (value === '') return { ok: false, message: label(name) + 'الطول مطلوب.' }
  if (NON_LATIN_DIGITS.test(value)) return { ok: false, message: label(name) + LATIN_DIGITS_MESSAGE }
  const cm = decimalToHundredths(value)
  if (cm === null) {
    return { ok: false, message: label(name) + 'الطول بالمتر وبحد أقصى منزلتين (مثال 27.50).' }
  }
  if (cm < 1 || cm > MAX_ROLL_CM) {
    return { ok: false, message: label(name) + 'الطول لازم يكون من 0.01 لـ 1000 متر.' }
  }
  return { ok: true, value: cm }
}

export function parseQuantity(text: string, name: string): Parsed<number> {
  const value = clean(text)
  if (value === '') return { ok: false, message: label(name) + 'الكمية مطلوبة.' }
  if (NON_LATIN_DIGITS.test(value)) return { ok: false, message: label(name) + LATIN_DIGITS_MESSAGE }
  if (!INTEGER.test(value)) return { ok: false, message: label(name) + 'الكمية لازم تكون عدد صحيح.' }
  const quantity = Number(value)
  if (quantity < 1 || quantity > MAX_QUANTITY) {
    return { ok: false, message: label(name) + 'الكمية لازم تكون من 1 لـ ' + String(MAX_QUANTITY) + '.' }
  }
  return { ok: true, value: quantity }
}

/** قروش → نص جنيه لخانة الإدخال (من غير float). */
export function piastresToPoundsText(piastres: number): string {
  const whole = Math.trunc(piastres / 100)
  const fraction = piastres % 100
  return fraction === 0 ? String(whole) : String(whole) + '.' + String(fraction).padStart(2, '0')
}

/** سم → نص متر لخانة الإدخال (من غير float). */
export function cmToMetersText(cm: number): string {
  return piastresToPoundsText(cm)
}

/** «27.50 متر — 2750 سم» */
export function formatMetersAndCm(cm: number): string {
  const whole = Math.trunc(cm / 100)
  const fraction = String(cm % 100).padStart(2, '0')
  return String(whole) + '.' + fraction + ' متر — ' + String(cm) + ' سم'
}

/** «1,250.50 ج.م» من قروش صحيحة (من غير float). */
export function formatPiastresExact(piastres: number): string {
  const negative = piastres < 0
  const abs = Math.abs(piastres)
  const whole = Math.trunc(abs / 100)
  const fraction = abs % 100
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const text = fraction === 0 ? grouped : grouped + '.' + String(fraction).padStart(2, '0')
  return (negative ? '-' : '') + text + ' ج.م'
}
