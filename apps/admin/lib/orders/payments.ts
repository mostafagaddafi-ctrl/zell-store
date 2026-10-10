/**
 * 0021-A P2 — الدفعات ورسوم التأكيد في اللوحة: منطق خالص (من غير server-only ولا أي استيراد قيمة برّه المجلد)،
 * فحالات lib/orders/payments.cases.ts بتشغّله فعليًا في CI.
 *
 *   • الداتابيز هي المرجع (backend/db/migrations/0021a_p1_payments.sql — دوال zell_payment_*). هنا العرض والتحقق المبدئي بس.
 *   • المبالغ بتتدخّل بالجنيه (لحد قرشين) وبتتبعت بالقرش. النسبة بتتدخّل وبتتعرض نسبة مئوية (مثلًا 2.5%)،
 *     وبتتخزّن بوحدة 0.01% (percent_bp: 250) — قرار المالك (2026-10-10).
 *   • النصوص الظاهرة كلها من هنا، ومفيش كود داخلي بيظهر للمستخدم.
 */
import type { OrderStatus } from '@zell/core'
import { orderErrorCode, orderFailureKind, type OrderFailureKind } from './cycle'

// ── الأنواع ─────────────────────────────────────────────────────────────
export type PaymentKind = 'payment' | 'refund'
export type PaymentPurpose = 'confirmation_fee' | 'balance'
export type PaymentStatusValue = 'unpaid' | 'partial' | 'paid'
export type FeeScope = 'all' | 'made_to_measure' | 'with_installation' | 'above_amount'
export type FeeMethod = 'shipping' | 'fixed' | 'percent'

export type PaymentRow = {
  id: number
  kind: PaymentKind
  amountPiastres: number
  purpose: PaymentPurpose
  methodName: string
  methodIsOther: boolean
  reference: string | null
  note: string | null
  createdAt: string
  paidAfterPiastres: number
}

export type PaymentSummary = {
  orderId: number
  status: OrderStatus
  updatedAt: string
  totalPiastres: number
  paidPiastres: number
  remainingPiastres: number
  feePiastres: number
  feeDuePiastres: number
  paymentStatus: PaymentStatusValue
  hasRefund: boolean
  refundedPiastres: number
  payments: PaymentRow[]
}

export type PaymentMethod = { id: number; name: string; sortOrder: number; isArchived: boolean; used: boolean; updatedAt: string }

export type FeeConfig = {
  enabled: boolean
  scope?: FeeScope
  method?: FeeMethod
  percent_bp?: number
  fixed_piastres?: number
  shipping_fallback_piastres?: number
  threshold_piastres?: number
}

export type PaymentSettings = {
  fee: FeeConfig
  creditEnabled: boolean
  paymentNumbers: string | null
  feePolicy: string | null
  whatsappTemplate: string | null
  updatedAt: string
}

// ── الثوابت والنصوص ─────────────────────────────────────────────────────
export const PAYMENT_PURPOSES: readonly PaymentPurpose[] = ['confirmation_fee', 'balance']
export const FEE_SCOPES: readonly FeeScope[] = ['made_to_measure', 'all', 'with_installation', 'above_amount']
export const FEE_METHODS: readonly FeeMethod[] = ['shipping', 'fixed', 'percent']
export const OTHER_METHOD = 'other'
export const PAYMENT_REFERENCE_MAX = 100
export const PAYMENT_NOTE_MAX = 300
export const METHOD_NAME_MAX = 60
export const PAYMENT_NUMBERS_MAX = 1000
export const FEE_POLICY_MAX = 1000
export const WHATSAPP_TEMPLATE_MAX = 2000
/** أقصى مبلغ في الإعداد بالقرش (= 1,000,000 جنيه) — نفس الداتابيز. */
export const SETTINGS_AMOUNT_MAX = 100000000

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatusValue, string>> = {
  unpaid: 'لم يُدفع',
  partial: 'مدفوع جزئيًا',
  paid: 'مدفوع بالكامل',
}

export const PURPOSE_LABELS: Readonly<Record<PaymentPurpose, string>> = {
  confirmation_fee: 'رسوم تأكيد الطلب',
  balance: 'باقي الطلب',
}

export const KIND_LABELS: Readonly<Record<PaymentKind, string>> = { payment: 'دفعة', refund: 'رد' }

export const FEE_SCOPE_LABELS: Readonly<Record<FeeScope, string>> = {
  all: 'كل الطلبات',
  made_to_measure: 'الطلبات اللي فيها منتج بالمقاس',
  with_installation: 'الطلبات اللي فيها تركيب',
  above_amount: 'الطلبات من مبلغ معيّن وأكتر',
}

export const FEE_METHOD_LABELS: Readonly<Record<FeeMethod, string>> = {
  shipping: 'قيمة الشحن',
  fixed: 'مبلغ ثابت',
  percent: 'نسبة من إجمالي الطلب',
}

export const PAYMENT_TEXT = {
  title: 'الدفع',
  unavailable: 'بيانات الدفع مش متاحة دلوقتي. حدّث الصفحة بعد شوية.',
  total: 'إجمالي الطلب',
  fee: 'رسوم تأكيد الطلب (مقدم)',
  feeDue: 'المتبقي من رسوم التأكيد',
  paid: 'المدفوع',
  refunded: 'المردود',
  remaining: 'الباقي',
  status: 'حالة الدفع',
  hasRefund: 'فيه رد',
  noPayments: 'مفيش دفعات متسجّلة.',
  history: 'سجل الدفعات',
  record: 'تسجيل دفعة',
  refund: 'تسجيل رد (للمالك)',
  deliver: 'تسليم الطلب مع التحصيل',
  deliverHint: 'التسليم بيتسجّل مع التحصيل في نفس الخطوة، والباقي لازم يبقى صفر.',
  deliverCredit: 'تسليم آجل (الباقي يفضل على العميل)',
  deliverCreditHint: 'البيع الآجل متفعّل من إعدادات الدفع. الباقي هيفضل ظاهر على الطلب.',
  deliverConfirm: 'تأكيد تسليم الطلب؟',
  deliverCreditConfirm: 'تأكيد التسليم الآجل؟ الباقي هيفضل على العميل.',
  refundConfirm: 'تأكيد تسجيل الرد؟',
  amount: 'المبلغ (جنيه)',
  purpose: 'الغرض',
  method: 'طريقة الدفع',
  otherMethod: 'أخرى',
  otherName: 'اسم الطريقة',
  reference: 'رقم العملية (اختياري)',
  note: 'ملاحظة (اختياري)',
  submit: 'تسجيل',
  saving: 'جارِ التسجيل…',
  saved: 'تم التسجيل.',
  delivered: 'تم تسليم الطلب.',
  needsRefund: 'الطلب ملغى وعليه مبلغ مدفوع — محتاج رد حسب سياسة الرسوم.',
  feeRequiredBeforeConfirm: 'الطلب مايتأكدش ولا يتجهز قبل تسجيل رسوم التأكيد.',
  whatsapp: 'رسالة واتساب جاهزة',
  whatsappHint: 'بتفتح واتساب بالنص، ومابتتبعتش لوحدها.',
} as const

export const PAYMENT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  '45416': 'البيانات غير صالحة. راجعها وحاول مرة أخرى.',
  '45417': 'إعدادات الرسوم غير مكتملة أو غير صالحة.',
  '45418': 'المبلغ المدفوع بيتسجّل من شاشة الدفع بس.',
  '45419': 'الطلب محتاج رسوم التأكيد قبل التأكيد أو التجهيز. سجّل الدفعة الأول.',
  '45420': 'فيه باقي على الطلب. استخدم «تسليم الطلب مع التحصيل».',
  '45421': 'البيع الآجل مقفول من إعدادات الدفع.',
  '45422': 'مينفعش تسجيل دفعة على طلب ملغى أو مرفوض الاستلام.',
  '45423': 'المبلغ أكبر من الباقي على الطلب.',
  '45424': 'المبلغ أكبر من المدفوع على الطلب.',
  '45425': 'العملية دي اتسجّلت قبل كده ببيانات مختلفة. حدّث الصفحة وابدأ من جديد.',
  '45426': 'الطريقة دي اتستخدمت في دفعات قبل كده. تقدر تأرشفها بس.',
  '45427': 'سجل الدفعات مايتعدّلش. التصحيح بيبقى بقيد عكسي.',
  '45428': 'طريقة الدفع مش متاحة. اختار طريقة تانية أو حدّث الصفحة.',
  '45429': 'إعدادات الدفع صف واحد بس.',
}

export const PAYMENT_SENTINELS: Readonly<Record<string, string>> = {
  ZELL_PAY_INVALID_INPUT: '45416',
  ZELL_PAY_SETTINGS_INVALID: '45417',
  ZELL_PAY_DIRECT_WRITE: '45418',
  ZELL_PAY_DEPOSIT_REQUIRED: '45419',
  ZELL_PAY_BALANCE_DUE: '45420',
  ZELL_PAY_CREDIT_DISABLED: '45421',
  ZELL_PAY_NOT_ALLOWED_IN_STATUS: '45422',
  ZELL_PAY_EXCEEDS_TOTAL: '45423',
  ZELL_PAY_REFUND_EXCEEDS_PAID: '45424',
  ZELL_PAY_COMMAND_REUSED: '45425',
  ZELL_PAY_METHOD_IN_USE: '45426',
  ZELL_PAY_APPEND_ONLY: '45427',
  ZELL_PAY_METHOD_UNAVAILABLE: '45428',
  ZELL_PAY_SETTINGS_GUARD: '45429',
}

/** الحقل اللي الداتابيز رفضته (detail في 45416 / 45417) ← رسالة واضحة. */
export const PAYMENT_FIELD_MESSAGES: Readonly<Record<string, string>> = {
  amount_piastres: 'المبلغ لازم يبقى أكبر من صفر.',
  purpose: 'اختار الغرض.',
  method: 'اختار طريقة دفع واحدة، أو اكتب اسم الطريقة لو «أخرى».',
  method_other: 'اسم الطريقة طويل.',
  reference: 'رقم العملية طويل (الحد 100 حرف).',
  note: 'الملاحظة طويلة (الحد 300 حرف).',
  name: 'اكتب اسم الطريقة (لحد 60 حرف).',
  name_taken: 'فيه طريقة شغالة بنفس الاسم.',
  sort_order: 'الترتيب غير صالح.',
  payment_numbers: 'أرقام الدفع طويلة (الحد 1000 حرف).',
  fee_policy: 'السياسة طويلة (الحد 1000 حرف).',
  whatsapp_template: 'قالب الرسالة طويل (الحد 2000 حرف).',
  enabled: 'حدّد الرسوم مفعّلة ولا لأ.',
  scope: 'اختار نطاق الرسوم.',
  method_fee: 'اختار طريقة حساب الرسوم.',
  percent_bp: 'النسبة لازم تكون أكبر من 0% ولحد 100% (لحد رقمين عشريين).',
  fixed_piastres: 'المبلغ الثابت لازم يبقى أكبر من صفر.',
  shipping_fallback_piastres: 'القيمة البديلة للشحن لازم تبقى أكبر من صفر.',
  threshold_piastres: 'الحد لازم يبقى أكبر من صفر.',
  customer_credit_enabled: 'حدّد البيع الآجل مفعّل ولا لأ.',
}

// ── المبالغ والنسبة ─────────────────────────────────────────────────────
/** جنيه (لحد قرشين، بفاصلة إنجليزي أو أرقام عربي) ← قرش. null = مش صالح أو ≤ 0. */
export function poundsInputToPiastres(raw: string, max: number = SETTINGS_AMOUNT_MAX): number | null {
  const text = toLatinDigits(raw).trim().replace('٫', '.')
  if (!/^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(text)) return null
  const [whole, frac = ''] = text.split('.')
  const piastres = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  return piastres >= 1 && piastres <= max ? piastres : null
}

/** قرش ← نص جنيه للخانة (من غير أصفار زيادة). */
export function piastresToPoundsInput(piastres: number): string {
  const whole = Math.floor(piastres / 100)
  const frac = piastres % 100
  return frac === 0 ? String(whole) : String(whole) + '.' + String(frac).padStart(2, '0').replace(/0$/, '')
}

/** النسبة كما يكتبها المالك (مثلًا 10 أو 2.5 أو ٢٫٥) ← وحدة 0.01% (1..10000). null = مش صالحة. */
export function percentInputToBp(raw: string): number | null {
  const text = toLatinDigits(raw).trim().replace('٫', '.').replace(/%$/, '').trim()
  if (!/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(text)) return null
  const [whole, frac = ''] = text.split('.')
  const bp = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  return bp >= 1 && bp <= 10000 ? bp : null
}

/** وحدة 0.01% ← نص النسبة للخانة (250 ← «2.5»). */
export function bpToPercentInput(bp: number): string {
  const whole = Math.floor(bp / 100)
  const frac = bp % 100
  return frac === 0 ? String(whole) : String(whole) + '.' + String(frac).padStart(2, '0').replace(/0$/, '')
}

/** وحدة 0.01% ← نسبة مئوية للعرض (250 ← «2.5%»). */
export function bpToPercentLabel(bp: number): string {
  return bpToPercentInput(bp) + '%'
}

function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

// ── إعداد الرسوم: الفورم ⇄ الإعداد ─────────────────────────────────────
export type FeeForm = {
  enabled: boolean
  scope: FeeScope
  method: FeeMethod
  percent: string
  fixedPounds: string
  fallbackPounds: string
  thresholdPounds: string
}

export function feeFormOf(config: FeeConfig): FeeForm {
  return {
    enabled: config.enabled,
    scope: config.scope ?? 'made_to_measure',
    method: config.method ?? 'shipping',
    percent: typeof config.percent_bp === 'number' ? bpToPercentInput(config.percent_bp) : '',
    fixedPounds: typeof config.fixed_piastres === 'number' ? piastresToPoundsInput(config.fixed_piastres) : '',
    fallbackPounds: typeof config.shipping_fallback_piastres === 'number' ? piastresToPoundsInput(config.shipping_fallback_piastres) : '',
    thresholdPounds: typeof config.threshold_piastres === 'number' ? piastresToPoundsInput(config.threshold_piastres) : '',
  }
}

/**
 * الفورم ← الإعداد بنفس قواعد الحفظ في الداتابيز: مفعّل = الحقول اللازمة للنطاق والطريقة صالحة (مفيش أرقام افتراضية).
 * الحقول غير اللازمة بتتحفظ بس لو صالحة (علشان المالك مايضيّعهاش لو قفل الرسوم مؤقتًا).
 */
export function feeConfigOf(form: FeeForm): { ok: true; config: FeeConfig } | { ok: false; field: string; message: string } {
  const config: FeeConfig = { enabled: form.enabled, scope: form.scope, method: form.method }
  const fields: Array<[keyof FeeConfig, string, (raw: string) => number | null, boolean]> = [
    ['percent_bp', form.percent, percentInputToBp, form.method === 'percent'],
    ['fixed_piastres', form.fixedPounds, (raw) => poundsInputToPiastres(raw), form.method === 'fixed'],
    ['shipping_fallback_piastres', form.fallbackPounds, (raw) => poundsInputToPiastres(raw), form.method === 'shipping'],
    ['threshold_piastres', form.thresholdPounds, (raw) => poundsInputToPiastres(raw), form.scope === 'above_amount'],
  ]
  for (const [key, raw, parse, needed] of fields) {
    const empty = raw.trim() === ''
    const value = empty ? null : parse(raw)
    if (value === null && (!empty || (needed && form.enabled))) {
      return { ok: false, field: key, message: PAYMENT_FIELD_MESSAGES[key] as string }
    }
    if (value !== null) (config as Record<string, unknown>)[key] = value
  }
  return { ok: true, config }
}

/** وصف الإعداد في سطر للمالك (من غير أي اسم داخلي). */
export function feeConfigLine(config: FeeConfig): string {
  if (!config.enabled || config.scope === undefined || config.method === undefined) return 'رسوم التأكيد مقفولة.'
  const scope = FEE_SCOPE_LABELS[config.scope] + (config.scope === 'above_amount' && typeof config.threshold_piastres === 'number'
    ? ' (' + piastresToPoundsInput(config.threshold_piastres) + ' جنيه)' : '')
  let how = FEE_METHOD_LABELS[config.method]
  if (config.method === 'percent' && typeof config.percent_bp === 'number') how += ' ' + bpToPercentLabel(config.percent_bp)
  if (config.method === 'fixed' && typeof config.fixed_piastres === 'number') how += ' ' + piastresToPoundsInput(config.fixed_piastres) + ' جنيه'
  if (config.method === 'shipping' && typeof config.shipping_fallback_piastres === 'number') {
    how += ' (ولو الشحن مجاني: ' + piastresToPoundsInput(config.shipping_fallback_piastres) + ' جنيه)'
  }
  return 'مفعّلة · ' + scope + ' · ' + how
}

// ── قراءة ردود الداتابيز ─────────────────────────────────────────────────
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const STATUSES: readonly string[] = ['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'refused', 'cancelled']

function parseRow(raw: unknown): PaymentRow | null {
  if (!isObj(raw)) return null
  const id = int(raw['id'])
  const amount = int(raw['amount_piastres'])
  const after = int(raw['paid_after_piastres'])
  const kind = raw['kind']
  const purpose = raw['purpose']
  const name = str(raw['method_name'])
  const at = str(raw['created_at'])
  if (id === null || amount === null || after === null || name === null || at === null) return null
  if (kind !== 'payment' && kind !== 'refund') return null
  if (purpose !== 'confirmation_fee' && purpose !== 'balance') return null
  return {
    id,
    kind,
    amountPiastres: amount,
    purpose,
    methodName: name,
    methodIsOther: raw['method_is_other'] === true,
    reference: str(raw['reference']),
    note: str(raw['note']),
    createdAt: at,
    paidAfterPiastres: after,
  }
}

export function parsePaymentSummary(raw: unknown): PaymentSummary | null {
  if (!isObj(raw) || raw['ok'] !== true) return null
  const nums = ['order_id', 'total_piastres', 'paid_piastres', 'remaining_piastres', 'confirmation_fee_piastres', 'fee_due_piastres', 'refunded_piastres'].map((k) => int(raw[k]))
  if (nums.some((n) => n === null)) return null
  const [orderId, total, paid, remaining, fee, feeDue, refunded] = nums as number[]
  const status = raw['status']
  const updatedAt = str(raw['updated_at'])
  const ps = raw['payment_status']
  if (typeof status !== 'string' || !STATUSES.includes(status) || updatedAt === null) return null
  if (ps !== 'unpaid' && ps !== 'partial' && ps !== 'paid') return null
  const rowsRaw = raw['payments']
  const rows = Array.isArray(rowsRaw) ? rowsRaw.map(parseRow) : []
  if (rows.some((r) => r === null)) return null
  return {
    orderId: orderId as number,
    status: status as OrderStatus,
    updatedAt,
    totalPiastres: total as number,
    paidPiastres: paid as number,
    remainingPiastres: remaining as number,
    feePiastres: fee as number,
    feeDuePiastres: feeDue as number,
    paymentStatus: ps,
    hasRefund: raw['has_refund'] === true,
    refundedPiastres: refunded as number,
    payments: rows as PaymentRow[],
  }
}

export function parseMethods(raw: unknown): PaymentMethod[] | null {
  if (!Array.isArray(raw)) return null
  const out: PaymentMethod[] = []
  for (const item of raw) {
    if (!isObj(item)) return null
    const id = int(item['id'])
    const name = str(item['name'])
    const sort = int(item['sort_order'])
    const at = str(item['updated_at'])
    if (id === null || name === null || sort === null || at === null) return null
    out.push({ id, name, sortOrder: sort, isArchived: item['is_archived'] === true, used: item['used'] === true, updatedAt: at })
  }
  return out
}

function parseFeeConfig(raw: unknown): FeeConfig | null {
  if (!isObj(raw) || typeof raw['enabled'] !== 'boolean') return null
  const config: FeeConfig = { enabled: raw['enabled'] }
  if (typeof raw['scope'] === 'string' && (FEE_SCOPES as readonly string[]).includes(raw['scope'])) config.scope = raw['scope'] as FeeScope
  if (typeof raw['method'] === 'string' && (FEE_METHODS as readonly string[]).includes(raw['method'])) config.method = raw['method'] as FeeMethod
  for (const key of ['percent_bp', 'fixed_piastres', 'shipping_fallback_piastres', 'threshold_piastres'] as const) {
    const n = int(raw[key])
    if (n !== null) config[key] = n
  }
  return config
}

export function parseSettings(raw: unknown): PaymentSettings | null {
  if (!isObj(raw)) return null
  const fee = parseFeeConfig(raw['confirmation_fee'])
  const at = str(raw['updated_at'])
  if (fee === null || at === null || typeof raw['customer_credit_enabled'] !== 'boolean') return null
  return {
    fee,
    creditEnabled: raw['customer_credit_enabled'],
    paymentNumbers: str(raw['payment_numbers']),
    feePolicy: str(raw['fee_policy']),
    whatsappTemplate: str(raw['whatsapp_template']),
    updatedAt: at,
  }
}

// ── الأخطاء ─────────────────────────────────────────────────────────────
export function paymentErrorCode(error: unknown): string | null {
  const code = orderErrorCode(error)
  if (code !== null) return code
  if (isObj(error) && typeof error['message'] === 'string') {
    for (const [name, value] of Object.entries(PAYMENT_SENTINELS)) {
      const message = error['message']
      if (message === name || message.startsWith(name + ':')) return value
    }
  }
  return null
}

/** نوع الفشل: الهوية والتعارض والطلب من دورة الطلب (A1)، وأكواد الدفعات برسالة واضحة (والحقل لو موجود). */
export function paymentFailureKind(error: unknown, httpStatus: number): OrderFailureKind {
  const code = paymentErrorCode(error)
  if (code === '45416' || code === '45417') {
    const detail = isObj(error) ? str(error['details']) : null
    const key = detail === 'method' && code === '45417' ? 'method_fee' : detail
    const fieldMessage = key !== null ? PAYMENT_FIELD_MESSAGES[key] : undefined
    return { kind: 'validation', message: fieldMessage ?? (PAYMENT_ERROR_MESSAGES[code] as string) }
  }
  if (code !== null && PAYMENT_ERROR_MESSAGES[code] !== undefined) return { kind: 'validation', message: PAYMENT_ERROR_MESSAGES[code] as string }
  return orderFailureKind(error, httpStatus)
}

// ── متى يظهر إيه ────────────────────────────────────────────────────────
/** تسجيل دفعة: أي حالة غير الملغي ورفض الاستلام، وطالما فيه باقي (زي الداتابيز · 45422 / 45423). */
export function canRecordPayment(summary: PaymentSummary): boolean {
  return summary.status !== 'cancelled' && summary.status !== 'refused' && summary.remainingPiastres > 0
}

/** الرد: أي حالة، طالما فيه مدفوع (45424). */
export function canRefund(summary: PaymentSummary): boolean {
  return summary.paidPiastres > 0
}

/** التسليم من هنا: الطلب «تم الشحن». */
export function canDeliver(summary: PaymentSummary): boolean {
  return summary.status === 'shipped'
}

/** الغرض المقترح للدفعة: رسوم التأكيد لو لسه عليها، غير كده الباقي. */
export function suggestedPurpose(summary: PaymentSummary): PaymentPurpose {
  return summary.feeDuePiastres > 0 ? 'confirmation_fee' : 'balance'
}

/** المبلغ المقترح (بالقرش): المتبقي من الرسوم، أو الباقي كله. */
export function suggestedAmount(summary: PaymentSummary, purpose: PaymentPurpose): number {
  return purpose === 'confirmation_fee' && summary.feeDuePiastres > 0 ? summary.feeDuePiastres : summary.remainingPiastres
}

/** «محتاج رد»: ملغي أو مرفوض الاستلام وعليه مدفوع. */
export function needsRefund(summary: PaymentSummary): boolean {
  return (summary.status === 'cancelled' || summary.status === 'refused') && summary.paidPiastres > 0
}

// ── رسالة واتساب (§٢-٤): القالب من الإعدادات، والمتغيرات من الطلب ─────────
export type TemplateValues = {
  name: string
  orderNumber: string
  total: string
  fee: string
  remaining: string
  paymentNumbers: string
  policy: string
}

export const TEMPLATE_VARIABLES: readonly string[] = ['{name}', '{order_number}', '{total}', '{fee}', '{remaining}', '{payment_numbers}', '{policy}']

export function renderTemplate(template: string, values: TemplateValues): string {
  const map: Record<string, string> = {
    '{name}': values.name,
    '{order_number}': values.orderNumber,
    '{total}': values.total,
    '{fee}': values.fee,
    '{remaining}': values.remaining,
    '{payment_numbers}': values.paymentNumbers,
    '{policy}': values.policy,
  }
  return template.replace(/\{(name|order_number|total|fee|remaining|payment_numbers|policy)\}/g, (match) => map[match] ?? match)
}

/** رابط واتساب بالنص (مابيبعتش حاجة لوحده). الموبايل 01xxxxxxxxx ← 201xxxxxxxxx. */
export function whatsappHref(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '')
  const intl = digits.startsWith('0') ? '2' + digits : digits
  return 'https://wa.me/' + intl + (text.trim() === '' ? '' : '?text=' + encodeURIComponent(text))
}
