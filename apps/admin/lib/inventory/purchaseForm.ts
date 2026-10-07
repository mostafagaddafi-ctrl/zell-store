/**
 * فاتورة الشراء — منطق خالص: شكل الـpayload بالظبط زي zell_inv_normalize_purchase، وتحويل النموذج.
 *
 * طبقتين:
 *   1. validatePurchaseDoc(raw) — تحقق بنيوي بالحرف من دالة الداتابيز (المفاتيح المسموحة، الأنواع،
 *      الحدود، NFC + trim). السيرفر بيشغّله على أي doc جاي من الواجهة قبل النداء.
 *   2. buildPurchasePayload(form, catalog, today) — النموذج → payload، ومعاه فحوص الكتالوج
 *      (وحدة البيع مع نوع البند، والعرض المسموح) والتاريخ، وبعدين بيعدّي على (1).
 * والداتابيز هي الحكم الأخير في كل حال.
 *
 * postReadinessIssues — قواعد الترحيل اللي الداتابيز بتفحصها وقت المعاينة/الترحيل (بند واحد على الأقل،
 * قاعدة التوزيع، الخصم أقل من إجمالي البنود). الحفظ كمسودة مسموح من غيرها.
 */

import type { CatalogProduct } from './catalog'
import { parseMeters, parsePounds, parseQuantity, MAX_AMOUNT_PIASTRES, MAX_QUANTITY, MAX_ROLL_CM, type Parsed } from './money'

export const PURCHASE_LIMITS = {
  lines: 100,
  charges: 50,
  rollsPerLine: 200,
  lotsPerDoc: 200,
  supplierRef: 60,
  note: 500,
  chargeReference: 60,
  chargeNoteMin: 3,
  chargeNoteMax: 200,
  zeroReasonMin: 3,
  zeroReasonMax: 200,
  widthMax: 1000,
} as const

export type ChargeKind = 'transport' | 'loading' | 'customs' | 'other'
export const CHARGE_KINDS: readonly ChargeKind[] = ['transport', 'loading', 'customs', 'other']
export const CHARGE_KIND_LABELS: Readonly<Record<ChargeKind, string>> = {
  transport: 'نقل',
  loading: 'تحميل وتنزيل',
  customs: 'جمارك',
  other: 'أخرى',
}

// ── شكل الـpayload (نفس مفاتيح الداتابيز بالظبط) ─────────────────────

export type PurchaseRollLinePayload = {
  kind: 'roll'
  productId: number
  widthCm: number
  rolls: { lengthCm: number }[]
  lineTotalPiastres: number
  zeroCostReason: string | null
}

export type PurchaseBatchLinePayload = {
  kind: 'batch'
  productId: number
  quantity: number
  lineTotalPiastres: number
  zeroCostReason: string | null
}

export type PurchaseLinePayload = PurchaseRollLinePayload | PurchaseBatchLinePayload

export type PurchaseChargePayload = {
  kind: ChargeKind
  amountPiastres: number
  reference: string | null
  note: string | null
}

export type PurchaseDocPayload = {
  supplierId: number | null
  supplierRef: string | null
  locationId: number
  docDate: string
  note: string | null
  charges: PurchaseChargePayload[]
  supplierDiscountPiastres: number
  lines: PurchaseLinePayload[]
}

// ── أدوات نصية بنفس قواعد الداتابيز ───────────────────────────────

/** btrim(normalize(x, NFC), E' \t\r\n') */
function dbTrim(value: string): string {
  return value.normalize('NFC').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
}

function codePoints(value: string): number {
  return Array.from(value).length
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return key
  return null
}

function intInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return null
  return value
}

/** نص اختياري: null/غايب → null، نص → trim (والفاضي null)، أي حاجة تانية → undefined (غلط). */
function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const trimmed = dbTrim(value)
  return trimmed === '' ? null : trimmed
}

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

export function isValidIsoDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** تاريخ النهارده بتوقيت القاهرة (نفس (now() at time zone 'Africa/Cairo')::date). */
export function cairoToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message }
}

// ── (1) التحقق البنيوي ─────────────────────────────────────────────

const DOC_KEYS = ['supplierId', 'supplierRef', 'locationId', 'docDate', 'note', 'charges', 'supplierDiscountPiastres', 'lines']
const CHARGE_KEYS = ['kind', 'amountPiastres', 'reference', 'note']
const ROLL_KEYS = ['kind', 'productId', 'widthCm', 'rolls', 'lineTotalPiastres', 'zeroCostReason']
const BATCH_KEYS = ['kind', 'productId', 'quantity', 'lineTotalPiastres', 'zeroCostReason']

const INVALID = 'بيانات الفاتورة غير صالحة: '

export function validatePurchaseDoc(raw: unknown): Parsed<PurchaseDocPayload> {
  if (!isObject(raw)) return fail(INVALID + 'الشكل.')
  // الداتابيز: octet_length(p_doc::text) <= 131072 — هنا بايتات UTF-8 لنفس الـJSON (تقريب أقل شوية).
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 131072) return fail(INVALID + 'الفاتورة أكبر من المسموح.')
  const extra = onlyKeys(raw, DOC_KEYS)
  if (extra !== null) return fail(INVALID + 'حقل غير معروف.')

  let supplierId: number | null = null
  if (raw['supplierId'] !== null && raw['supplierId'] !== undefined) {
    supplierId = intInRange(raw['supplierId'], 1, Number.MAX_SAFE_INTEGER)
    if (supplierId === null) return fail(INVALID + 'المورد.')
  }

  const supplierRef = optionalText(raw['supplierRef'])
  if (supplierRef === undefined || (supplierRef !== null && codePoints(supplierRef) > PURCHASE_LIMITS.supplierRef)) {
    return fail('رقم فاتورة المورد لحد ' + String(PURCHASE_LIMITS.supplierRef) + ' حرف.')
  }

  const locationId = intInRange(raw['locationId'], 1, Number.MAX_SAFE_INTEGER)
  if (locationId === null) return fail('المخزن مطلوب.')

  const docDate = raw['docDate']
  if (typeof docDate !== 'string' || !isValidIsoDate(docDate)) return fail('تاريخ الفاتورة غير صالح.')

  const note = optionalText(raw['note'])
  if (note === undefined || (note !== null && codePoints(note) > PURCHASE_LIMITS.note)) {
    return fail('الملاحظة لحد ' + String(PURCHASE_LIMITS.note) + ' حرف.')
  }

  let discount = 0
  if (raw['supplierDiscountPiastres'] !== null && raw['supplierDiscountPiastres'] !== undefined) {
    const value = intInRange(raw['supplierDiscountPiastres'], 0, MAX_AMOUNT_PIASTRES)
    if (value === null) return fail('خصم المورد غير صالح.')
    discount = value
  }

  // المصاريف
  const charges: PurchaseChargePayload[] = []
  const rawCharges = raw['charges']
  if (rawCharges !== null && rawCharges !== undefined) {
    if (!Array.isArray(rawCharges) || rawCharges.length > PURCHASE_LIMITS.charges) {
      return fail('المصاريف لحد ' + String(PURCHASE_LIMITS.charges) + '.')
    }
    for (let i = 0; i < rawCharges.length; i += 1) {
      const at = 'مصروف ' + String(i + 1) + ': '
      const item: unknown = rawCharges[i]
      if (!isObject(item) || onlyKeys(item, CHARGE_KEYS) !== null) return fail(at + 'الشكل غير صالح.')
      const kind = item['kind']
      if (typeof kind !== 'string' || !(CHARGE_KINDS as readonly string[]).includes(kind)) return fail(at + 'النوع غير صالح.')
      const amount = intInRange(item['amountPiastres'], 1, MAX_AMOUNT_PIASTRES)
      if (amount === null) return fail(at + 'المبلغ لازم يكون أكبر من صفر.')
      const reference = optionalText(item['reference'])
      if (reference === undefined || (reference !== null && codePoints(reference) > PURCHASE_LIMITS.chargeReference)) {
        return fail(at + 'المرجع لحد ' + String(PURCHASE_LIMITS.chargeReference) + ' حرف.')
      }
      const chargeNote = optionalText(item['note'])
      if (
        chargeNote === undefined ||
        (chargeNote !== null &&
          (codePoints(chargeNote) < PURCHASE_LIMITS.chargeNoteMin || codePoints(chargeNote) > PURCHASE_LIMITS.chargeNoteMax))
      ) {
        return fail(at + 'الملاحظة من 3 لـ 200 حرف.')
      }
      if (kind === 'other' && chargeNote === null) return fail(at + 'نوع «أخرى» محتاج ملاحظة توضّحه.')
      charges.push({ kind: kind as ChargeKind, amountPiastres: amount, reference, note: chargeNote })
    }
  }

  // البنود
  const lines: PurchaseLinePayload[] = []
  let lots = 0
  const rawLines = raw['lines']
  if (rawLines !== null && rawLines !== undefined) {
    if (!Array.isArray(rawLines) || rawLines.length > PURCHASE_LIMITS.lines) {
      return fail('البنود لحد ' + String(PURCHASE_LIMITS.lines) + '.')
    }
    for (let i = 0; i < rawLines.length; i += 1) {
      const at = 'بند ' + String(i + 1) + ': '
      const item: unknown = rawLines[i]
      if (!isObject(item)) return fail(at + 'الشكل غير صالح.')
      const kind = item['kind']
      if (kind !== 'roll' && kind !== 'batch') return fail(at + 'النوع غير صالح.')
      if (onlyKeys(item, kind === 'roll' ? ROLL_KEYS : BATCH_KEYS) !== null) return fail(at + 'حقل غير معروف.')
      const productId = intInRange(item['productId'], 1, 2147483647)
      if (productId === null) return fail(at + 'المنتج مطلوب.')
      const total = intInRange(item['lineTotalPiastres'], 0, MAX_AMOUNT_PIASTRES)
      if (total === null) return fail(at + 'إجمالي البند غير صالح.')
      const reason = optionalText(item['zeroCostReason'])
      if (
        reason === undefined ||
        (reason !== null &&
          (codePoints(reason) < PURCHASE_LIMITS.zeroReasonMin || codePoints(reason) > PURCHASE_LIMITS.zeroReasonMax))
      ) {
        return fail(at + 'سبب التكلفة الصفر من 3 لـ 200 حرف.')
      }
      if ((total === 0) !== (reason !== null)) {
        return fail(total === 0 ? at + 'البند اللي تكلفته صفر محتاج سبب.' : at + 'سبب التكلفة الصفر للبند اللي تكلفته صفر بس.')
      }

      if (kind === 'roll') {
        const widthCm = intInRange(item['widthCm'], 1, PURCHASE_LIMITS.widthMax)
        if (widthCm === null) return fail(at + 'العرض غير صالح.')
        const rawRolls = item['rolls']
        if (!Array.isArray(rawRolls) || rawRolls.length < 1 || rawRolls.length > PURCHASE_LIMITS.rollsPerLine) {
          return fail(at + 'لازم لفّة واحدة على الأقل ولحد ' + String(PURCHASE_LIMITS.rollsPerLine) + '.')
        }
        const rolls: { lengthCm: number }[] = []
        for (let j = 0; j < rawRolls.length; j += 1) {
          const roll: unknown = rawRolls[j]
          if (!isObject(roll) || onlyKeys(roll, ['lengthCm']) !== null) return fail(at + 'لفّة ' + String(j + 1) + ' غير صالحة.')
          const lengthCm = intInRange(roll['lengthCm'], 1, MAX_ROLL_CM)
          if (lengthCm === null) return fail(at + 'طول لفّة ' + String(j + 1) + ' غير صالح.')
          rolls.push({ lengthCm })
        }
        lots += rolls.length
        lines.push({ kind: 'roll', productId, widthCm, rolls, lineTotalPiastres: total, zeroCostReason: reason })
      } else {
        const quantity = intInRange(item['quantity'], 1, MAX_QUANTITY)
        if (quantity === null) return fail(at + 'الكمية غير صالحة.')
        lots += 1
        lines.push({ kind: 'batch', productId, quantity, lineTotalPiastres: total, zeroCostReason: reason })
      }
    }
    if (lots > PURCHASE_LIMITS.lotsPerDoc) {
      return fail('عدد الدفعات (اللفّات + بنود القطع) لحد ' + String(PURCHASE_LIMITS.lotsPerDoc) + ' في الفاتورة.')
    }
  }

  return {
    ok: true,
    value: { supplierId, supplierRef, locationId, docDate, note, charges, supplierDiscountPiastres: discount, lines },
  }
}

// ── قواعد الترحيل والإجماليات ─────────────────────────────────────

export type DraftTotals = {
  itemsSubtotalPiastres: number
  extrasTotalPiastres: number
  supplierDiscountPiastres: number
  totalCostPiastres: number
  lotCount: number
}

export function draftTotals(doc: PurchaseDocPayload): DraftTotals {
  let items = 0
  let lots = 0
  for (const line of doc.lines) {
    items += line.lineTotalPiastres
    lots += line.kind === 'roll' ? line.rolls.length : 1
  }
  let extras = 0
  for (const charge of doc.charges) extras += charge.amountPiastres
  return {
    itemsSubtotalPiastres: items,
    extrasTotalPiastres: extras,
    supplierDiscountPiastres: doc.supplierDiscountPiastres,
    totalCostPiastres: items + extras - doc.supplierDiscountPiastres,
    lotCount: lots,
  }
}

/** نفس فحوص الداتابيز وقت المعاينة/الترحيل (45209 · 45210 · 45211). */
export function postReadinessIssues(doc: PurchaseDocPayload): string[] {
  const issues: string[] = []
  const totals = draftTotals(doc)
  if (doc.lines.length === 0) issues.push('لازم بند واحد على الأقل قبل الترحيل.')
  if ((totals.extrasTotalPiastres > 0 || totals.supplierDiscountPiastres > 0) && totals.itemsSubtotalPiastres === 0) {
    issues.push('مينفعش توزيع المصاريف أو الخصم وإجمالي البنود صفر.')
  }
  if (totals.supplierDiscountPiastres > 0 && totals.supplierDiscountPiastres >= totals.itemsSubtotalPiastres) {
    issues.push('خصم المورد لازم يكون أقل من إجمالي البنود.')
  }
  return issues
}

// ── (2) النموذج ────────────────────────────────────────────────────

export type RollForm = { key: string; meters: string }

export type RollLineForm = {
  key: string
  kind: 'roll'
  productId: string
  widthCm: string
  rolls: RollForm[]
  total: string
  zeroCostReason: string
}

export type BatchLineForm = {
  key: string
  kind: 'batch'
  productId: string
  quantity: string
  total: string
  zeroCostReason: string
}

export type LineForm = RollLineForm | BatchLineForm

export type ChargeForm = { key: string; kind: ChargeKind; amount: string; reference: string; note: string }

export type PurchaseFormState = {
  supplierId: string
  supplierRef: string
  locationId: string
  docDate: string
  note: string
  discount: string
  charges: ChargeForm[]
  lines: LineForm[]
}

export function emptyPurchaseForm(defaults: { locationId: number | null; today: string }): PurchaseFormState {
  return {
    supplierId: '',
    supplierRef: '',
    locationId: defaults.locationId === null ? '' : String(defaults.locationId),
    docDate: defaults.today,
    note: '',
    discount: '',
    charges: [],
    lines: [],
  }
}

export function newRollLine(key: string, rollKey: string): RollLineForm {
  return { key, kind: 'roll', productId: '', widthCm: '', rolls: [{ key: rollKey, meters: '' }], total: '', zeroCostReason: '' }
}

export function newBatchLine(key: string): BatchLineForm {
  return { key, kind: 'batch', productId: '', quantity: '', total: '', zeroCostReason: '' }
}

export function newCharge(key: string): ChargeForm {
  return { key, kind: 'transport', amount: '', reference: '', note: '' }
}

function textFromPiastres(piastres: number): string {
  const whole = Math.trunc(piastres / 100)
  const fraction = piastres % 100
  return fraction === 0 ? String(whole) : String(whole) + '.' + String(fraction).padStart(2, '0')
}

/** مسودة محفوظة → نموذج. newKey بيدي مفاتيح React ثابتة. */
export function payloadToForm(doc: PurchaseDocPayload, newKey: () => string): PurchaseFormState {
  return {
    supplierId: doc.supplierId === null ? '' : String(doc.supplierId),
    supplierRef: doc.supplierRef ?? '',
    locationId: String(doc.locationId),
    docDate: doc.docDate,
    note: doc.note ?? '',
    discount: doc.supplierDiscountPiastres === 0 ? '' : textFromPiastres(doc.supplierDiscountPiastres),
    charges: doc.charges.map((charge) => ({
      key: newKey(),
      kind: charge.kind,
      amount: textFromPiastres(charge.amountPiastres),
      reference: charge.reference ?? '',
      note: charge.note ?? '',
    })),
    lines: payloadLinesToForm(doc.lines, newKey),
  }
}

/**
 * بنود payload محفوظة → بنود نموذج (مشتركة بين الشراء ورصيد أول المدة — بنود رصيد أول المدة فيها
 * نفس الحقول دي وزيادة).
 */
export function payloadLinesToForm(lines: readonly PurchaseLinePayload[], newKey: () => string): LineForm[] {
  return lines.map((line) =>
      line.kind === 'roll'
        ? {
            key: newKey(),
            kind: 'roll' as const,
            productId: String(line.productId),
            widthCm: String(line.widthCm),
            rolls: line.rolls.map((roll) => ({ key: newKey(), meters: textFromPiastres(roll.lengthCm) })),
            total: textFromPiastres(line.lineTotalPiastres),
            zeroCostReason: line.zeroCostReason ?? '',
          }
        : {
            key: newKey(),
            kind: 'batch' as const,
            productId: String(line.productId),
            quantity: String(line.quantity),
            total: textFromPiastres(line.lineTotalPiastres),
            zeroCostReason: line.zeroCostReason ?? '',
          },
    )
}

function optionalId(text: string): number | null | undefined {
  const value = text.trim()
  if (value === '') return null
  if (!/^[0-9]{1,15}$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id >= 1 ? id : undefined
}

/**
 * النموذج → payload. بيفحص الكتالوج (وحدة البيع + العرض المسموح) والتاريخ، وبعدين بيعدّي على
 * validatePurchaseDoc عشان الشكل النهائي يبقى بالحرف زي الداتابيز.
 */
export function buildPurchasePayload(
  form: PurchaseFormState,
  catalog: ReadonlyMap<number, CatalogProduct>,
  today: string,
): Parsed<PurchaseDocPayload> {
  const supplierId = optionalId(form.supplierId)
  if (supplierId === undefined) return fail('المورد غير صالح.')

  const locationId = optionalId(form.locationId)
  if (locationId === undefined || locationId === null) return fail('اختار المخزن.')

  const docDate = form.docDate.trim()
  if (!isValidIsoDate(docDate)) return fail('تاريخ الفاتورة مطلوب.')
  if (docDate > today) return fail('تاريخ الفاتورة مينفعش يكون في المستقبل.')

  const discount = parsePounds(form.discount, { name: 'خصم المورد', allowZero: true, required: false })
  if (!discount.ok) return discount

  const charges: unknown[] = []
  for (let i = 0; i < form.charges.length; i += 1) {
    const charge = form.charges[i] as ChargeForm
    const at = 'مصروف ' + String(i + 1)
    const amount = parsePounds(charge.amount, { name: at, allowZero: false, required: true })
    if (!amount.ok) return amount
    charges.push({ kind: charge.kind, amountPiastres: amount.value, reference: charge.reference, note: charge.note })
  }

  const lines = formLinesToPayload(form.lines, catalog)
  if (!lines.ok) return lines

  return validatePurchaseDoc({
    supplierId,
    supplierRef: form.supplierRef,
    locationId,
    docDate,
    note: form.note,
    charges,
    supplierDiscountPiastres: discount.value,
    lines: lines.value,
  })
}

/**
 * بنود النموذج → بنود payload (من غير تحقق بنيوي نهائي — المستدعي بيعدّيها على validate*Doc).
 * بيفحص الكتالوج: المنتج موجود، ووحدة البيع مع نوع البند (لفّات للمتر، قطع للعدد)، والعرض المسموح.
 * مشتركة بين الشراء ورصيد أول المدة. ترتيب الناتج = ترتيب البنود في النموذج.
 */
export function formLinesToPayload(
  formLines: readonly LineForm[],
  catalog: ReadonlyMap<number, CatalogProduct>,
): Parsed<Array<Record<string, unknown>>> {
  const lines: Array<Record<string, unknown>> = []
  for (let i = 0; i < formLines.length; i += 1) {
    const line = formLines[i] as LineForm
    const at = 'بند ' + String(i + 1)
    const productId = optionalId(line.productId)
    if (productId === undefined || productId === null) return fail(at + ': اختار المنتج.')
    const product = catalog.get(productId)
    if (!product) return fail(at + ': المنتج مش موجود في الكتالوج.')
    const expectedUnit = line.kind === 'roll' ? 'meter' : 'piece'
    if (product.saleUnit !== expectedUnit) {
      return fail(at + ': ' + (line.kind === 'roll' ? 'اللفّات لمنتجات المتر بس.' : 'القطع لمنتجات العدد بس.'))
    }
    const total = parsePounds(line.total, { name: at + ' (الإجمالي)', allowZero: true, required: true })
    if (!total.ok) return total
    const reason = total.value === 0 ? line.zeroCostReason : null

    if (line.kind === 'roll') {
      const widthCm = optionalId(line.widthCm)
      if (widthCm === undefined || widthCm === null) return fail(at + ': اختار العرض.')
      if (!product.allowedWidthsCm.includes(widthCm)) return fail(at + ': العرض ده مش من عروض المنتج المسموحة.')
      if (line.rolls.length === 0) return fail(at + ': لازم لفّة واحدة على الأقل.')
      const rolls: { lengthCm: number }[] = []
      for (let j = 0; j < line.rolls.length; j += 1) {
        const roll = line.rolls[j] as RollForm
        const length = parseMeters(roll.meters, at + ' لفّة ' + String(j + 1))
        if (!length.ok) return length
        rolls.push({ lengthCm: length.value })
      }
      lines.push({ kind: 'roll', productId, widthCm, rolls, lineTotalPiastres: total.value, zeroCostReason: reason })
    } else {
      const quantity = parseQuantity(line.quantity, at)
      if (!quantity.ok) return quantity
      lines.push({ kind: 'batch', productId, quantity: quantity.value, lineTotalPiastres: total.value, zeroCostReason: reason })
    }
  }
  return { ok: true, value: lines }
}

// ── أسباب الاستبعاد والإبطال ────────────────────────────────────────

export const REASON_LIMITS = {
  /** الاستبعاد: إجباري في الواجهة (أشد من الداتابيز اللي بتسمح بيه فاضي) — 1 لـ 300. */
  discard: { min: 1, max: 300 },
  /** الإبطال: نفس الداتابيز — 3 لـ 300. */
  void: { min: 3, max: 300 },
} as const

export function normalizeReason(raw: unknown, kind: 'discard' | 'void'): Parsed<string> {
  if (typeof raw !== 'string') return fail('السبب مطلوب.')
  const reason = dbTrim(raw)
  const { min, max } = REASON_LIMITS[kind]
  const length = codePoints(reason)
  if (length === 0) return fail('السبب مطلوب.')
  if (length < min || length > max) return fail('السبب من ' + String(min) + ' لـ ' + String(max) + ' حرف.')
  return { ok: true, value: reason }
}
