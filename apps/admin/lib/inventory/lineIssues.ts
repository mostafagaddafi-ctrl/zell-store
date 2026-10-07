/**
 * فحص كل بند لوحده وملخّصه للكارت المقفول — منطق خالص (عقد PR-D).
 *
 * lineIssue: أول مشكلة في البند ومعاها الحقل اللي يتعمله focus (عشان الكارت يتفتح على الغلط).
 *   ⚠️ للعرض بس — الحكم النهائي لـ build*Payload (ومن وراه الداتابيز). الرسائل بنفس صياغة
 *      formLinesToPayload / validate*Doc ومسبوقة بـ «بند N».
 * summarizeLine: نص الكارت المقفول — المنتج، النوع، الكمية/الطول، إجمالي الشراء، تكلفة المتر/القطعة
 *   التقريبية (أعداد صحيحة)، وسعر البيع الحالي (مرجعية).
 */

import type { CatalogProduct } from './catalog'
import { formatMetersAndCm, parseMeters, parsePounds, parseQuantity } from './money'
import type { LineEstimate } from './openingForm'
import { costPerMeter, costPerPiece, currentSalePrice, type SalePrice } from './pricing'
import type { LineForm } from './purchaseForm'

export type LineField = 'product' | 'width' | 'rolls' | 'quantity' | 'total' | 'zeroReason' | 'estimate'
export type LineIssue = { field: LineField; message: string }
export type LineDocKind = 'purchase' | 'opening'

function codePoints(value: string): number {
  return Array.from(value.normalize('NFC').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')).length
}

function optionalId(text: string): number | null {
  const value = text.trim()
  if (!/^[0-9]{1,15}$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id >= 1 ? id : null
}

export function lineIssue(
  line: LineForm,
  index: number,
  catalog: ReadonlyMap<number, CatalogProduct>,
  kind: LineDocKind,
  estimate?: LineEstimate,
): LineIssue | null {
  const at = 'بند ' + String(index + 1)
  const issue = (field: LineField, text: string): LineIssue => ({ field, message: at + ': ' + text })

  const productId = optionalId(line.productId)
  if (productId === null) return issue('product', 'اختار المنتج.')
  const product = catalog.get(productId)
  if (!product) return issue('product', 'المنتج مش موجود في الكتالوج.')
  if (product.saleUnit !== (line.kind === 'roll' ? 'meter' : 'piece')) {
    return issue('product', line.kind === 'roll' ? 'اللفّات لمنتجات المتر بس.' : 'القطع لمنتجات العدد بس.')
  }

  if (line.kind === 'roll') {
    const widthCm = optionalId(line.widthCm)
    if (widthCm === null) return issue('width', 'اختار العرض.')
    if (!product.allowedWidthsCm.includes(widthCm)) return issue('width', 'العرض ده مش من عروض المنتج المسموحة.')
    if (line.rolls.length === 0) return issue('rolls', 'لازم لفّة واحدة على الأقل.')
    for (let j = 0; j < line.rolls.length; j += 1) {
      const roll = line.rolls[j]
      const parsed = parseMeters(roll ? roll.meters : '', at + ' لفّة ' + String(j + 1))
      if (!parsed.ok) return { field: 'rolls', message: parsed.message }
    }
  } else {
    const quantity = parseQuantity(line.quantity, at)
    if (!quantity.ok) return { field: 'quantity', message: quantity.message }
  }

  const total = parsePounds(line.total, { name: at + ' (الإجمالي)', allowZero: true, required: true })
  if (!total.ok) return { field: 'total', message: total.message }

  const estimated = kind === 'opening' && estimate !== undefined && estimate.estimated
  if (total.value === 0) {
    const reason = codePoints(line.zeroCostReason)
    if (reason === 0) return issue('zeroReason', 'البند اللي تكلفته صفر محتاج سبب.')
    if (reason < 3 || reason > 200) return issue('zeroReason', 'سبب التكلفة الصفر من 3 لـ 200 حرف.')
    if (estimated) return issue('estimate', 'البند اللي تكلفته صفر مينفعش يكون تقديري.')
  }
  if (estimated && estimate) {
    const note = codePoints(estimate.note)
    if (note === 0) return issue('estimate', 'التكلفة التقديرية محتاجة ملاحظة توضّح التقدير.')
    if (note < 3 || note > 200) return issue('estimate', 'ملاحظة التقدير من 3 لـ 200 حرف.')
  }
  return null
}

/** مشاكل كل البنود بمفتاح البند (للكروت). البند السليم مش موجود في الناتج. */
export function lineIssues(
  lines: readonly LineForm[],
  catalog: ReadonlyMap<number, CatalogProduct>,
  kind: LineDocKind,
  estimates: Readonly<Record<string, LineEstimate>> = {},
): Map<string, LineIssue> {
  const map = new Map<string, LineIssue>()
  lines.forEach((line, index) => {
    const found = lineIssue(line, index, catalog, kind, estimates[line.key])
    if (found) map.set(line.key, found)
  })
  return map
}

// ── ملخص الكارت ─────────────────────────────────────────────────────

export type LineSummary = {
  productId: number | null
  productName: string | null
  kindLabel: string
  amountText: string
  totalPiastres: number | null
  unitCostPiastres: number | null
  unitLabel: 'متر' | 'قطعة'
  salePrice: SalePrice | null
  /** إجمالي الطول بالسم (لفّات) أو الكمية (قطع) — null لو مش كامل. */
  measure: number | null
}

export function summarizeLine(line: LineForm, catalog: ReadonlyMap<number, CatalogProduct>): LineSummary {
  const productId = optionalId(line.productId)
  const product = productId === null ? undefined : catalog.get(productId)
  const total = parsePounds(line.total, { name: '', allowZero: true, required: true })
  const totalPiastres = total.ok ? total.value : null

  if (line.kind === 'roll') {
    let lengthCm = 0
    let complete = line.rolls.length > 0
    for (const roll of line.rolls) {
      const parsed = parseMeters(roll.meters, '')
      if (parsed.ok) lengthCm += parsed.value
      else complete = false
    }
    const widthCm = optionalId(line.widthCm)
    return {
      productId,
      productName: product ? product.nameAr : null,
      kindLabel: 'لفّات (بالمتر)',
      amountText: String(line.rolls.length) + ' لفّة' + (complete ? ' · ' + formatMetersAndCm(lengthCm) : ''),
      totalPiastres,
      unitCostPiastres: complete && totalPiastres !== null ? costPerMeter(totalPiastres, lengthCm) : null,
      unitLabel: 'متر',
      salePrice: product && product.saleUnit === 'meter' ? currentSalePrice(product, widthCm) : null,
      measure: complete ? lengthCm : null,
    }
  }

  const quantity = parseQuantity(line.quantity, '')
  return {
    productId,
    productName: product ? product.nameAr : null,
    kindLabel: 'قطع (بالعدد)',
    amountText: quantity.ok ? String(quantity.value) + ' قطعة' : '—',
    totalPiastres,
    unitCostPiastres: quantity.ok && totalPiastres !== null ? costPerPiece(totalPiastres, quantity.value) : null,
    unitLabel: 'قطعة',
    salePrice: product && product.saleUnit === 'piece' ? currentSalePrice(product, null) : null,
    measure: quantity.ok ? quantity.value : null,
  }
}

/** «قفل الكل»: البنود اللي فيها مشكلة ظاهرة بتفضل مفتوحة. */
export function keysOpenAfterCloseAll(issueKeys: Iterable<string>): string[] {
  return [...issueKeys]
}
