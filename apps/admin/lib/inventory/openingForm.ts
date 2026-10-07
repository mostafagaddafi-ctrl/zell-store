/**
 * رصيد أول المدة — منطق خالص: شكل الـpayload بالظبط زي zell_inv_normalize_opening، وتحويل النموذج.
 *
 * الفرق عن فاتورة الشراء: مفيش مورد ولا مصاريف ولا خصم، والتاريخ asOfDate، وكل بند ليه
 * costIsEstimated (إجباري) و estimateNote (إجبارية مع التقدير بس، 3–200 حرف).
 * قاعدة التكلفة الصفر هنا أشد: بند تكلفته صفر لازم يكون ليه سبب **ومايكونش تقديري**.
 *
 * البنود نفسها (المنتج، الوحدة، العرض المسموح، اللفّات بالمتر، الكمية، الإجمالي بالجنيه) بتتبني
 * بنفس formLinesToPayload بتاعة الشراء — فحوص الكتالوج واحدة. والداتابيز هي الحكم الأخير.
 */

import type { CatalogProduct } from './catalog'
import { MAX_AMOUNT_PIASTRES, MAX_QUANTITY, MAX_ROLL_CM, type Parsed } from './money'
import {
  PURCHASE_LIMITS,
  formLinesToPayload,
  isValidIsoDate,
  payloadLinesToForm,
  type LineForm,
} from './purchaseForm'

export const OPENING_LIMITS = { estimateNoteMin: 3, estimateNoteMax: 200 } as const

export type OpeningRollLinePayload = {
  kind: 'roll'
  productId: number
  widthCm: number
  rolls: { lengthCm: number }[]
  lineTotalPiastres: number
  costIsEstimated: boolean
  estimateNote: string | null
  zeroCostReason: string | null
}

export type OpeningBatchLinePayload = {
  kind: 'batch'
  productId: number
  quantity: number
  lineTotalPiastres: number
  costIsEstimated: boolean
  estimateNote: string | null
  zeroCostReason: string | null
}

export type OpeningLinePayload = OpeningRollLinePayload | OpeningBatchLinePayload

export type OpeningDocPayload = {
  locationId: number
  asOfDate: string
  note: string | null
  lines: OpeningLinePayload[]
}

// ── أدوات بنفس قواعد الداتابيز ────────────────────────────────────

function dbTrim(value: string): string {
  return value.normalize('NFC').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
}

function codePoints(value: string): number {
  return Array.from(value).length
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function intInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return null
  return value
}

function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const trimmed = dbTrim(value)
  return trimmed === '' ? null : trimmed
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message }
}

function textInRange(value: string | null, min: number, max: number): boolean {
  if (value === null) return true
  const length = codePoints(value)
  return length >= min && length <= max
}

// ── التحقق البنيوي ─────────────────────────────────────────────────

const DOC_KEYS = ['locationId', 'asOfDate', 'note', 'lines']
const ROLL_KEYS = ['kind', 'productId', 'widthCm', 'rolls', 'lineTotalPiastres', 'costIsEstimated', 'estimateNote', 'zeroCostReason']
const BATCH_KEYS = ['kind', 'productId', 'quantity', 'lineTotalPiastres', 'costIsEstimated', 'estimateNote', 'zeroCostReason']

export function validateOpeningDoc(raw: unknown): Parsed<OpeningDocPayload> {
  if (!isObject(raw)) return fail('بيانات رصيد أول المدة غير صالحة.')
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 131072) return fail('المستند أكبر من المسموح.')
  if (!onlyKeys(raw, DOC_KEYS)) return fail('بيانات رصيد أول المدة غير صالحة: حقل غير معروف.')

  const locationId = intInRange(raw['locationId'], 1, Number.MAX_SAFE_INTEGER)
  if (locationId === null) return fail('المخزن مطلوب.')

  const asOfDate = raw['asOfDate']
  if (typeof asOfDate !== 'string' || !isValidIsoDate(asOfDate)) return fail('تاريخ الرصيد غير صالح.')

  const note = optionalText(raw['note'])
  if (note === undefined || !textInRange(note, 1, PURCHASE_LIMITS.note)) {
    return fail('الملاحظة لحد ' + String(PURCHASE_LIMITS.note) + ' حرف.')
  }

  const lines: OpeningLinePayload[] = []
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
      if (!onlyKeys(item, kind === 'roll' ? ROLL_KEYS : BATCH_KEYS)) return fail(at + 'حقل غير معروف.')
      const productId = intInRange(item['productId'], 1, 2147483647)
      if (productId === null) return fail(at + 'المنتج مطلوب.')
      const total = intInRange(item['lineTotalPiastres'], 0, MAX_AMOUNT_PIASTRES)
      if (total === null) return fail(at + 'إجمالي البند غير صالح.')
      const estimated = item['costIsEstimated']
      if (typeof estimated !== 'boolean') return fail(at + 'حدد التكلفة فعلية ولا تقديرية.')
      const estimateNote = optionalText(item['estimateNote'])
      if (estimateNote === undefined || !textInRange(estimateNote, OPENING_LIMITS.estimateNoteMin, OPENING_LIMITS.estimateNoteMax)) {
        return fail(at + 'ملاحظة التقدير من 3 لـ 200 حرف.')
      }
      const reason = optionalText(item['zeroCostReason'])
      if (reason === undefined || !textInRange(reason, PURCHASE_LIMITS.zeroReasonMin, PURCHASE_LIMITS.zeroReasonMax)) {
        return fail(at + 'سبب التكلفة الصفر من 3 لـ 200 حرف.')
      }
      if (estimated !== (estimateNote !== null)) {
        return fail(estimated ? at + 'التكلفة التقديرية محتاجة ملاحظة توضّح التقدير.' : at + 'ملاحظة التقدير للتكلفة التقديرية بس.')
      }
      if (total === 0 && (reason === null || estimated)) {
        return fail(reason === null ? at + 'البند اللي تكلفته صفر محتاج سبب.' : at + 'البند اللي تكلفته صفر مينفعش يكون تقديري.')
      }
      if (total > 0 && reason !== null) return fail(at + 'سبب التكلفة الصفر للبند اللي تكلفته صفر بس.')

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
          if (!isObject(roll) || !onlyKeys(roll, ['lengthCm'])) return fail(at + 'لفّة ' + String(j + 1) + ' غير صالحة.')
          const lengthCm = intInRange(roll['lengthCm'], 1, MAX_ROLL_CM)
          if (lengthCm === null) return fail(at + 'طول لفّة ' + String(j + 1) + ' غير صالح.')
          rolls.push({ lengthCm })
        }
        lots += rolls.length
        lines.push({ kind: 'roll', productId, widthCm, rolls, lineTotalPiastres: total, costIsEstimated: estimated, estimateNote, zeroCostReason: reason })
      } else {
        const quantity = intInRange(item['quantity'], 1, MAX_QUANTITY)
        if (quantity === null) return fail(at + 'الكمية غير صالحة.')
        lots += 1
        lines.push({ kind: 'batch', productId, quantity, lineTotalPiastres: total, costIsEstimated: estimated, estimateNote, zeroCostReason: reason })
      }
    }
    if (lots > PURCHASE_LIMITS.lotsPerDoc) {
      return fail('عدد الدفعات (اللفّات + بنود القطع) لحد ' + String(PURCHASE_LIMITS.lotsPerDoc) + ' في المستند.')
    }
  }

  return { ok: true, value: { locationId, asOfDate, note, lines } }
}

// ── الإجماليات وقواعد الترحيل ─────────────────────────────────────

export type OpeningTotals = { itemsTotalPiastres: number; estimatedTotalPiastres: number; lotCount: number }

/** نفس حساب الداتابيز: الإجمالي = مجموع البنود، والتقديري = مجموع البنود التقديرية. */
export function openingTotals(doc: OpeningDocPayload): OpeningTotals {
  let items = 0
  let estimated = 0
  let lots = 0
  for (const line of doc.lines) {
    items += line.lineTotalPiastres
    if (line.costIsEstimated) estimated += line.lineTotalPiastres
    lots += line.kind === 'roll' ? line.rolls.length : 1
  }
  return { itemsTotalPiastres: items, estimatedTotalPiastres: estimated, lotCount: lots }
}

export function openingPostIssues(doc: OpeningDocPayload): string[] {
  return doc.lines.length === 0 ? ['لازم بند واحد على الأقل قبل الترحيل.'] : []
}

// ── النموذج ────────────────────────────────────────────────────────

export type LineEstimate = { estimated: boolean; note: string }

export type OpeningFormState = {
  locationId: string
  asOfDate: string
  note: string
  lines: LineForm[]
  /** التقدير لكل بند بمفتاح البند في النموذج (line.key). الغايب = تكلفة فعلية. */
  estimates: Record<string, LineEstimate>
}

export function emptyOpeningForm(defaults: { locationId: number | null; today: string }): OpeningFormState {
  return {
    locationId: defaults.locationId === null ? '' : String(defaults.locationId),
    asOfDate: defaults.today,
    note: '',
    lines: [],
    estimates: {},
  }
}

export function openingPayloadToForm(doc: OpeningDocPayload, newKey: () => string): OpeningFormState {
  const lines = payloadLinesToForm(doc.lines, newKey)
  const estimates: Record<string, LineEstimate> = {}
  lines.forEach((line, index) => {
    const source = doc.lines[index]
    if (source && source.costIsEstimated) estimates[line.key] = { estimated: true, note: source.estimateNote ?? '' }
  })
  return { locationId: String(doc.locationId), asOfDate: doc.asOfDate, note: doc.note ?? '', lines, estimates }
}

function optionalId(text: string): number | null | undefined {
  const value = text.trim()
  if (value === '') return null
  if (!/^[0-9]{1,15}$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id >= 1 ? id : undefined
}

/** النموذج → payload: فحوص الكتالوج والتاريخ، والتقدير لكل بند، وبعدين validateOpeningDoc. */
export function buildOpeningPayload(
  form: OpeningFormState,
  catalog: ReadonlyMap<number, CatalogProduct>,
  today: string,
): Parsed<OpeningDocPayload> {
  const locationId = optionalId(form.locationId)
  if (locationId === undefined || locationId === null) return fail('اختار المخزن.')

  const asOfDate = form.asOfDate.trim()
  if (!isValidIsoDate(asOfDate)) return fail('تاريخ الرصيد مطلوب.')
  if (asOfDate > today) return fail('تاريخ الرصيد مينفعش يكون في المستقبل.')

  const built = formLinesToPayload(form.lines, catalog)
  if (!built.ok) return built

  const lines = built.value.map((line, index) => {
    const key = form.lines[index]?.key ?? ''
    const estimate = form.estimates[key]
    const estimated = estimate !== undefined && estimate.estimated
    return { ...line, costIsEstimated: estimated, estimateNote: estimated && estimate ? estimate.note : null }
  })

  return validateOpeningDoc({ locationId, asOfDate, note: form.note, lines })
}
