import { orderErrorCode, orderFailureKind, type OrderFailureKind } from './cycle'

/**
 * EXPRESS-SHIPPING W2 — كارت «مدة الشحن والشحن السريع» في صفحة الشحن (العقد docs/contracts/EXPRESS-SHIPPING.md §٢-٥). منطق خالص.
 *
 * القراية zell_shipping_options_get (أي أدمن شغّال) والحفظ zell_shipping_options_save (المالك بس) بجلسة المستخدم،
 * والقرار النهائي (الهوية · النسخة 45404 · التحقق 45432) في الداتابيز. التحقق هنا نفس قواعد الداتابيز بالحرف علشان رسالة أوضح.
 * الكارت بيتحفظ لوحده (أسعار الشحن العادي بتتحفظ بـ zell_save_shipping في الكارت اللي فوقه).
 */

/** نفس حدود الداتابيز (zell_shipping_options_save). */
export const SHIPPING_DAYS_MAX = 60
export const EXPRESS_PRICE_MAX_PIASTRES = 100000000
export const SHIPPING_GOVERNORATES_MAX = 60
export const SHIPPING_GOVERNORATE_NAME_MAX = 40

export type GovernorateShippingOptions = {
  standardDaysMin: number | null
  standardDaysMax: number | null
  expressEnabled: boolean
  expressPricePiastres: number | null
  expressDaysMin: number | null
  expressDaysMax: number | null
}

export type ShippingOptionsSettings = {
  expressEnabled: boolean
  governorates: Record<string, GovernorateShippingOptions>
  updatedAt: string
}

/** شكل كل محافظة في p_governorates (المفاتيح الست زي الداتابيز). */
export type GovernoratePayload = {
  standard_days_min: number | null
  standard_days_max: number | null
  express_enabled: boolean
  express_price_piastres: number | null
  express_days_min: number | null
  express_days_max: number | null
}

export type ShippingOptionsInput = {
  expectedUpdatedAt: string
  expressEnabled: boolean
  governorates: Record<string, GovernoratePayload>
}

/** صف في الفورم (نصوص زي ما المالك كتبها؛ السعر بالجنيه). */
export type GovernorateRowForm = {
  name: string
  /** متاحة في الشحن العادي (في الأسعار ومش موقوفة). */
  served: boolean
  standardMin: string
  standardMax: string
  expressEnabled: boolean
  expressPrice: string
  expressMin: string
  expressMax: string
}

export type ShippingOptionsForm = { expressEnabled: boolean; rows: GovernorateRowForm[] }

export const SHIPPING_OPTIONS_TEXT = {
  title: 'مدة الشحن والشحن السريع',
  intro:
    'يحدد هذا الإعداد مدة الشحن العادي (اختيارية) وإتاحة الشحن السريع وسعره الكامل ومدته لكل محافظة. تبدأ المدة من تاريخ الشحن الفعلي، ولا يظهر للعميل أي تاريخ وصول.',
  separateSave: 'يُحفظ هذا الإعداد مستقلًا عن أسعار الشحن العادي أعلاه، بزر الحفظ الخاص به.',
  globalToggle: 'تفعيل الشحن السريع',
  globalHint: 'عند الإيقاف لا يظهر خيار «شحن سريع» للعميل في أي محافظة، ويستمر الشحن العادي كما هو.',
  freeNote: 'الشحن المجاني يُطبَّق على الشحن العادي فقط، ويُحتسب الشحن السريع بسعره الكامل دائمًا.',
  standardDays: 'مدة الشحن العادي (بالأيام، اختيارية)',
  expressToggle: 'شحن سريع متاح',
  expressPrice: 'سعر الشحن السريع الكامل (ج.م)',
  expressDays: 'مدة الشحن السريع (بالأيام)',
  from: 'من',
  to: 'إلى',
  notServed: 'غير متاحة في الشحن العادي — لن يُتاح لها الشحن السريع.',
  empty: 'لا توجد محافظات في الشحن العادي.',
  ownerOnly: 'الحفظ متاح للمالك فقط.',
  unavailable: 'إعداد مدة الشحن والشحن السريع غير متاح حاليًا.',
  saved: 'تم الحفظ.',
  save: 'حفظ إعداد الشحن السريع',
  saving: 'جارٍ الحفظ…',
} as const

export const SHIPPING_FIELD_MESSAGES: Readonly<Record<string, string>> = {
  express_enabled: 'حدد تفعيل الشحن السريع أو إيقافه.',
  governorates: 'قائمة المحافظات غير صالحة (60 محافظة كحد أقصى).',
  governorate_name: 'اسم المحافظة غير صالح أو مكرر (40 حرفًا كحد أقصى).',
  governorate_shape: 'بيانات المحافظة غير صالحة.',
  standard_days: 'مدة الشحن العادي: اترك الحقلين فارغين، أو أدخل عددين صحيحين من 0 إلى 60 بحيث لا يزيد الأول على الثاني.',
  express_price: 'سعر الشحن السريع: أدخل مبلغًا من 0.01 إلى 1,000,000 ج.م، وهو مطلوب عند إتاحة الشحن السريع.',
  express_days: 'مدة الشحن السريع: أدخل عددين صحيحين من 0 إلى 60 بحيث لا يزيد الأول على الثاني، وهي مطلوبة عند إتاحة الشحن السريع.',
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** رد zell_shipping_options_get أو _save. أي شكل تاني = null («غير متاح»). */
export function parseShippingOptionsSettings(raw: unknown): ShippingOptionsSettings | null {
  if (!isObj(raw)) return null
  const enabled = raw['express_enabled']
  const govs = raw['governorates']
  const at = raw['updated_at']
  if (typeof enabled !== 'boolean' || !isObj(govs) || typeof at !== 'string' || at === '') return null
  const governorates: Record<string, GovernorateShippingOptions> = {}
  for (const [name, cfg] of Object.entries(govs)) {
    if (!isObj(cfg)) continue
    governorates[name] = {
      standardDaysMin: intOrNull(cfg['standard_days_min']),
      standardDaysMax: intOrNull(cfg['standard_days_max']),
      expressEnabled: cfg['express_enabled'] === true,
      expressPricePiastres: intOrNull(cfg['express_price_piastres']),
      expressDaysMin: intOrNull(cfg['express_days_min']),
      expressDaysMax: intOrNull(cfg['express_days_max']),
    }
  }
  return { expressEnabled: enabled, governorates, updatedAt: at }
}

function numText(value: number | null): string {
  return value === null ? '' : String(value)
}

/** السعر بالقرش ← نص بالجنيه (12000 ← «120»، 12050 ← «120.50»). */
export function piastresText(value: number | null): string {
  if (value === null) return ''
  return value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2)
}

/**
 * الفورم أول ما يتفتح: المحافظات المتاحة في الشحن العادي بنفس ترتيبه، وبعدها أي محافظة محفوظة في الإعداد ومش
 * متاحة في العادي (عليها علامة). من غير أي حفظ.
 */
export function formOf(settings: ShippingOptionsSettings, served: readonly string[]): ShippingOptionsForm {
  const names = [...served, ...Object.keys(settings.governorates).filter((name) => !served.includes(name))]
  return {
    expressEnabled: settings.expressEnabled,
    rows: names.map((name) => {
      const saved = settings.governorates[name]
      return {
        name,
        served: served.includes(name),
        standardMin: numText(saved?.standardDaysMin ?? null),
        standardMax: numText(saved?.standardDaysMax ?? null),
        expressEnabled: saved?.expressEnabled ?? false,
        expressPrice: piastresText(saved?.expressPricePiastres ?? null),
        expressMin: numText(saved?.expressDaysMin ?? null),
        expressMax: numText(saved?.expressDaysMax ?? null),
      }
    }),
  }
}

const DAYS_TEXT = /^[0-9]{1,2}$/
const POUNDS_TEXT = /^[0-9]{1,7}(?:\.[0-9]{1,2})?$/

function rowMessage(name: string, field: string): string {
  return 'محافظة «' + name + '»: ' + (SHIPPING_FIELD_MESSAGES[field] ?? (SHIPPING_FIELD_MESSAGES['governorate_shape'] as string))
}

function parseDays(min: string, max: string): { ok: true; min: number | null; max: number | null } | { ok: false } {
  const a = min.trim()
  const b = max.trim()
  if (a === '' && b === '') return { ok: true, min: null, max: null }
  if (!DAYS_TEXT.test(a) || !DAYS_TEXT.test(b)) return { ok: false }
  const lo = Number(a)
  const hi = Number(b)
  if (lo > hi || hi > SHIPPING_DAYS_MAX) return { ok: false }
  return { ok: true, min: lo, max: hi }
}

function parsePrice(text: string): { ok: true; piastres: number | null } | { ok: false } {
  const t = text.trim()
  if (t === '') return { ok: true, piastres: null }
  if (!POUNDS_TEXT.test(t)) return { ok: false }
  const piastres = Math.round(Number(t) * 100)
  if (!Number.isSafeInteger(piastres) || piastres < 1 || piastres > EXPRESS_PRICE_MAX_PIASTRES) return { ok: false }
  return { ok: true, piastres }
}

function isBlankRow(row: GovernorateRowForm): boolean {
  return (
    !row.expressEnabled &&
    row.standardMin.trim() === '' &&
    row.standardMax.trim() === '' &&
    row.expressPrice.trim() === '' &&
    row.expressMin.trim() === '' &&
    row.expressMax.trim() === ''
  )
}

/**
 * من الفورم للي بيتبعت (المفاتيح الست لكل محافظة). الصف الفاضي بالكامل مابيتبعتش. نفس قواعد الداتابيز:
 * المدة الاتنين فاضيين أو عددين صحيحين 0 ≤ من ≤ إلى ≤ 60 · السعر 1..100,000,000 قرش · المتاح لازم له سعر ومدة.
 */
export function governoratesOf(form: ShippingOptionsForm): { ok: true; governorates: Record<string, GovernoratePayload> } | { ok: false; message: string } {
  const governorates: Record<string, GovernoratePayload> = {}
  for (const row of form.rows) {
    if (isBlankRow(row)) continue
    const name = row.name.normalize('NFC').trim()
    if (name === '' || Array.from(name).length > SHIPPING_GOVERNORATE_NAME_MAX || Object.prototype.hasOwnProperty.call(governorates, name)) {
      return { ok: false, message: SHIPPING_FIELD_MESSAGES['governorate_name'] as string }
    }
    const standard = parseDays(row.standardMin, row.standardMax)
    if (!standard.ok) return { ok: false, message: rowMessage(name, 'standard_days') }
    const price = parsePrice(row.expressPrice)
    if (!price.ok) return { ok: false, message: rowMessage(name, 'express_price') }
    const express = parseDays(row.expressMin, row.expressMax)
    if (!express.ok) return { ok: false, message: rowMessage(name, 'express_days') }
    if (row.expressEnabled && price.piastres === null) return { ok: false, message: rowMessage(name, 'express_price') }
    if (row.expressEnabled && express.min === null) return { ok: false, message: rowMessage(name, 'express_days') }
    governorates[name] = {
      standard_days_min: standard.min,
      standard_days_max: standard.max,
      express_enabled: row.expressEnabled,
      express_price_piastres: price.piastres,
      express_days_min: express.min,
      express_days_max: express.max,
    }
  }
  if (Object.keys(governorates).length > SHIPPING_GOVERNORATES_MAX) return { ok: false, message: SHIPPING_FIELD_MESSAGES['governorates'] as string }
  return { ok: true, governorates }
}

function validDays(min: unknown, max: unknown): boolean {
  if (min === null && max === null) return true
  return (
    typeof min === 'number' &&
    typeof max === 'number' &&
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= 0 &&
    min <= max &&
    max <= SHIPPING_DAYS_MAX
  )
}

/** فحص السيرفر قبل النداء (نفس قواعد الداتابيز) على اللي جاي من الفورم. null = سليم. */
export function payloadIssue(input: { expressEnabled: unknown; governorates: unknown }): string | null {
  if (typeof input.expressEnabled !== 'boolean') return SHIPPING_FIELD_MESSAGES['express_enabled'] as string
  if (!isObj(input.governorates) || Object.keys(input.governorates).length > SHIPPING_GOVERNORATES_MAX) {
    return SHIPPING_FIELD_MESSAGES['governorates'] as string
  }
  const keys = ['standard_days_min', 'standard_days_max', 'express_enabled', 'express_price_piastres', 'express_days_min', 'express_days_max']
  for (const [name, cfg] of Object.entries(input.governorates)) {
    const clean = name.normalize('NFC').trim()
    if (clean === '' || clean !== name || Array.from(clean).length > SHIPPING_GOVERNORATE_NAME_MAX) {
      return SHIPPING_FIELD_MESSAGES['governorate_name'] as string
    }
    if (!isObj(cfg) || Object.keys(cfg).some((key) => !keys.includes(key))) return rowMessage(name, 'governorate_shape')
    if (!validDays(cfg['standard_days_min'] ?? null, cfg['standard_days_max'] ?? null)) return rowMessage(name, 'standard_days')
    if (typeof cfg['express_enabled'] !== 'boolean') return rowMessage(name, 'governorate_shape')
    const price = cfg['express_price_piastres'] ?? null
    if (price !== null && !(typeof price === 'number' && Number.isInteger(price) && price >= 1 && price <= EXPRESS_PRICE_MAX_PIASTRES)) {
      return rowMessage(name, 'express_price')
    }
    if (!validDays(cfg['express_days_min'] ?? null, cfg['express_days_max'] ?? null)) return rowMessage(name, 'express_days')
    if (cfg['express_enabled'] === true && price === null) return rowMessage(name, 'express_price')
    if (cfg['express_enabled'] === true && (cfg['express_days_min'] ?? null) === null) return rowMessage(name, 'express_days')
  }
  return null
}

/** اللي بيتبعت للحفظ — بيتبني من الفورم بس وقت الضغط على «حفظ». */
export function inputOf(form: ShippingOptionsForm, settings: ShippingOptionsSettings): { ok: true; input: ShippingOptionsInput } | { ok: false; message: string } {
  const built = governoratesOf(form)
  if (!built.ok) return built
  return { ok: true, input: { expectedUpdatedAt: settings.updatedAt, expressEnabled: form.expressEnabled, governorates: built.governorates } }
}

/** نوع الفشل: 45432 برسالة الحقل (والمحافظة من hint)، والباقي من دورة الطلب (45400 · 45401 · 45402 · 45404). */
export function shippingOptionsFailureKind(error: unknown, httpStatus: number): OrderFailureKind {
  if (orderErrorCode(error) === '45432') {
    const detail = isObj(error) && typeof error['details'] === 'string' ? error['details'] : null
    const hint = isObj(error) && typeof error['hint'] === 'string' && error['hint'] !== '' ? error['hint'] : null
    const field = detail !== null && SHIPPING_FIELD_MESSAGES[detail] !== undefined ? detail : 'governorate_shape'
    return { kind: 'validation', message: hint !== null ? rowMessage(hint, field) : (SHIPPING_FIELD_MESSAGES[field] as string) }
  }
  return orderFailureKind(error, httpStatus)
}
