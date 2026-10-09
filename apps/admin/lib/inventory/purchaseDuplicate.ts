/**
 * تكرار فاتورة شراء — منطق خالص (من غير server-only): من فاتورة موجودة لمسودة جديدة كمساعدة لإعادة الشراء.
 *
 *   • من غير SQL ومن غير كتابة جديدة: الناتج بيتملى في نموذج «فاتورة جديدة» العادي، والحفظ بنفس createPurchaseAction
 *     ونفس التحقق (buildPurchasePayload ← validatePurchaseDoc) ونفس المعاينة. مفيش إنشاء ولا ترحيل بمجرد الضغط.
 *   • بيتنسخ: المورد · المخزن · البنود (المنتج · العرض · أطوال اللفّات · الكمية · الإجمالي · سبب التكلفة الصفر) ·
 *     خصم المورد · المصاريف (النوع · المبلغ · الملاحظة) · ملاحظة الفاتورة.
 *   • مابيتنسخش: رقم المستند · docId · الحالة · النسخة · تواريخ الإنشاء والترحيل والإبطال والاستبعاد وأسبابها ·
 *     الـ lots وأكوادها · التوزيعات المحسوبة · أي command أو audit ID · رقم فاتورة المورد ومرجع المصروف (خاصين بالأصل).
 *     الـ payload نفسه مافيهوش أي خانة للحاجات دي أصلًا.
 *   • التاريخ = النهارده (بيتعرض في النموذج قبل الحفظ ويتعدّل).
 *   • الأصل مابيتلمسش: قراية بس، والدوال هنا مابتعدّلش المدخلات.
 *   • مورد أو مخزن موقوف = تحذير والخانة بتفضى، والحفظ مقفول لحد اختيار بديل نشط. منتج موقوف أو وحدة بيعه أو عروضه
 *     اتغيّرت = خطأ واضح، والحفظ مقفول لحد التصحيح.
 */

import type { CatalogProduct } from './catalog'
import {
  payloadToForm,
  type LineForm,
  type PurchaseChargePayload,
  type PurchaseDocPayload,
  type PurchaseFormState,
  type PurchaseLinePayload,
} from './purchaseForm'
import type { PurchaseDetail } from './purchases'

export type DuplicateSeed = {
  sourceDocId: number
  sourceDocNo: string
  payload: PurchaseDocPayload
  supplierCleared: boolean
  locationCleared: boolean
  notes: string[]
}

export type DuplicateContext = {
  catalog: ReadonlyMap<number, CatalogProduct>
  activeSupplierIds: ReadonlySet<number>
  activeLocationIds: ReadonlySet<number>
}

function copyCharge(charge: { kind: PurchaseChargePayload['kind']; amountPiastres: number; note: string | null }): PurchaseChargePayload {
  return { kind: charge.kind, amountPiastres: charge.amountPiastres, reference: null, note: charge.note }
}

function copyLine(line: PurchaseLinePayload): PurchaseLinePayload {
  return line.kind === 'roll'
    ? {
        kind: 'roll',
        productId: line.productId,
        widthCm: line.widthCm,
        rolls: line.rolls.map((roll) => ({ lengthCm: roll.lengthCm })),
        lineTotalPiastres: line.lineTotalPiastres,
        zeroCostReason: line.zeroCostReason,
      }
    : {
        kind: 'batch',
        productId: line.productId,
        quantity: line.quantity,
        lineTotalPiastres: line.lineTotalPiastres,
        zeroCostReason: line.zeroCostReason,
      }
}

/** الفاتورة (أي حالة) → payload مسودة جديدة بتاريخ النهارده. problems = بيانات ناقصة في الأصل (نادر). */
export function duplicatePayload(detail: PurchaseDetail, today: string): { payload: PurchaseDocPayload; problems: string[] } {
  const { header } = detail
  const problems: string[] = []
  let lines: PurchaseLinePayload[]
  let charges: PurchaseChargePayload[]

  if (detail.draftPayload !== null) {
    lines = detail.draftPayload.lines.map(copyLine)
    charges = detail.draftPayload.charges.map(copyCharge)
  } else {
    lines = []
    const sorted = [...detail.lines].sort((a, b) => a.lineNo - b.lineNo)
    for (const line of sorted) {
      if (line.kind === 'roll') {
        const rolls = detail.lots
          .filter((lot) => lot.lineNo === line.lineNo && lot.lotKind === 'roll')
          .sort((a, b) => a.lotSequence - b.lotSequence)
          .map((lot) => ({ lengthCm: lot.initialLengthCm ?? 0 }))
        if (line.rollCount !== null && rolls.length !== line.rollCount) {
          problems.push('بند ' + String(line.lineNo) + ': أطوال اللفّات في الأصل ناقصة، راجعها.')
        }
        lines.push({
          kind: 'roll',
          productId: line.productId,
          widthCm: line.widthCm ?? 0,
          rolls,
          lineTotalPiastres: line.lineTotalPiastres,
          zeroCostReason: line.zeroCostReason,
        })
      } else {
        lines.push({
          kind: 'batch',
          productId: line.productId,
          quantity: line.quantity ?? 0,
          lineTotalPiastres: line.lineTotalPiastres,
          zeroCostReason: line.zeroCostReason,
        })
      }
    }
    charges = [...detail.charges].sort((a, b) => a.chargeNo - b.chargeNo).map(copyCharge)
  }

  const source = detail.draftPayload
  return {
    payload: {
      supplierId: source !== null ? source.supplierId : header.supplierId,
      supplierRef: null,
      locationId: source !== null ? source.locationId : header.locationId,
      docDate: today,
      note: source !== null ? source.note : header.note,
      charges,
      supplierDiscountPiastres: source !== null ? source.supplierDiscountPiastres : header.supplierDiscountPiastres,
      lines,
    },
    problems,
  }
}

/** مشكلة بند مع الكتالوج الحالي (المنتج · نشط · وحدة البيع · العرض)، أو null. */
export function lineCatalogProblem(
  kind: 'roll' | 'batch',
  productId: number,
  widthCm: number | null,
  catalog: ReadonlyMap<number, CatalogProduct>,
): string | null {
  const product = catalog.get(productId)
  if (!product) return 'المنتج #' + String(productId) + ' مش موجود في الكتالوج.'
  if (!product.isActive) return 'المنتج «' + product.nameAr + '» موقوف.'
  const expected = kind === 'roll' ? 'meter' : 'piece'
  if (product.saleUnit !== expected) return 'وحدة بيع «' + product.nameAr + '» اتغيّرت، فنوع البند مابقاش مناسب.'
  if (kind === 'roll' && (widthCm === null || !product.allowedWidthsCm.includes(widthCm))) {
    return 'العرض ' + String(widthCm ?? 0) + ' سم مابقاش من عروض «' + product.nameAr + '».'
  }
  return null
}

export function buildDuplicateSeed(detail: PurchaseDetail, today: string, context: DuplicateContext): DuplicateSeed {
  const { payload, problems } = duplicatePayload(detail, today)
  const notes = [...problems]
  const supplierCleared = payload.supplierId !== null && !context.activeSupplierIds.has(payload.supplierId)
  if (supplierCleared) {
    notes.push('المورد «' + (detail.header.supplierName ?? 'مورد') + '» موقوف أو مش موجود: اختار مورد نشط قبل الحفظ.')
  }
  const locationCleared = !context.activeLocationIds.has(payload.locationId)
  if (locationCleared) {
    notes.push('المخزن «' + detail.header.locationName + '» موقوف أو مش موجود: اختار مخزن نشط قبل الحفظ.')
  }
  payload.lines.forEach((line, index) => {
    const problem = lineCatalogProblem(line.kind, line.productId, line.kind === 'roll' ? line.widthCm : null, context.catalog)
    if (problem !== null) notes.push('بند ' + String(index + 1) + ': ' + problem + ' صحّحه قبل الحفظ.')
  })
  return {
    sourceDocId: detail.header.docId,
    sourceDocNo: detail.header.docNo,
    payload,
    supplierCleared,
    locationCleared,
    notes,
  }
}

/** البذرة → نموذج «فاتورة جديدة». المورد أو المخزن الموقوف بيفضى، ورقم فاتورة المورد فاضي. */
export function duplicateToForm(seed: DuplicateSeed, newKey: () => string): PurchaseFormState {
  const form = payloadToForm(seed.payload, newKey)
  return {
    ...form,
    supplierRef: '',
    supplierId: seed.supplierCleared ? '' : form.supplierId,
    locationId: seed.locationCleared ? '' : form.locationId,
  }
}

function formId(text: string): number | null {
  const value = text.trim()
  if (!/^[0-9]{1,15}$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id >= 1 ? id : null
}

function lineProblem(line: LineForm, catalog: ReadonlyMap<number, CatalogProduct>): string | null {
  const productId = formId(line.productId)
  if (productId === null) return null
  return lineCatalogProblem(line.kind, productId, line.kind === 'roll' ? formId(line.widthCm) : null, catalog)
}

/**
 * موانع الحفظ للنسخة (فوق التحقق العادي): مورد مطلوب بدل الموقوف · مورد أو مخزن مش نشط · منتج موقوف أو وحدته أو
 * عرضه اتغيّر. فاضية = الحفظ يكمّل على التحقق العادي.
 */
export function duplicateFormBlockers(form: PurchaseFormState, context: DuplicateContext & { supplierRequired: boolean }): string[] {
  const blockers: string[] = []
  const supplierId = formId(form.supplierId)
  if (context.supplierRequired && supplierId === null) blockers.push('اختار مورد نشط بدل المورد الموقوف قبل الحفظ.')
  if (supplierId !== null && !context.activeSupplierIds.has(supplierId)) blockers.push('المورد المختار مش نشط.')
  const locationId = formId(form.locationId)
  if (locationId !== null && !context.activeLocationIds.has(locationId)) blockers.push('المخزن المختار مش نشط.')
  form.lines.forEach((line, index) => {
    const problem = lineProblem(line, context.catalog)
    if (problem !== null) blockers.push('بند ' + String(index + 1) + ': ' + problem)
  })
  return blockers
}
