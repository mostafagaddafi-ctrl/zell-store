/**
 * أسعار البيع المرجعية والتكاليف التقريبية للعرض — منطق خالص، من غير float في الحساب.
 *
 * سعر البيع الحالي (مرجعية بس — بيتعدّل من صفحة المنتج، ومفيش مصدر تاني جوه المخزون):
 *   • القطعة: products.price_per_meter_piastres (نفس العمود = سعر القطعة).
 *   • المتر: سعر العرض الفعّال من product_widths لو موجود، وإلا سعر المنتج الأساسي لو العرض المختار
 *     هو العرض الأساسي — نفس coalesce(w.price, p.price) في zell_create_order.
 *   ⚠️ ده السعر **الحالي**، مش لقطة وقت الترحيل (0020 مابتحفظش سعر البيع)، ومفيش «ربح» بيتحسب منه.
 *
 * التقريب لأقرب قرش بأعداد صحيحة: round(n / d) = floor((2n + d) / 2d)
 * (نفس floor((n + d/2) / d) بس من غير كسر). أي قيمة خارج Number.MAX_SAFE_INTEGER → null (مايتعرضش).
 */

import type { CatalogProduct } from './catalog'

export type SalePrice = { pricePiastres: number; unit: 'meter' | 'piece'; widthCm: number | null }

export function currentSalePrice(product: CatalogProduct, widthCm: number | null): SalePrice | null {
  if (product.saleUnit === 'piece') return { pricePiastres: product.basePricePiastres, unit: 'piece', widthCm: null }
  if (widthCm === null) return null
  const option = product.widthOptions.find((w) => w.widthCm === widthCm)
  if (option) return { pricePiastres: option.pricePerMeterPiastres, unit: 'meter', widthCm }
  if (product.baseWidthCm !== null && widthCm === product.baseWidthCm) {
    return { pricePiastres: product.basePricePiastres, unit: 'meter', widthCm }
  }
  return null
}

function safe(value: number): boolean {
  return Number.isSafeInteger(value)
}

/** floor(a / b) بالظبط لأعداد صحيحة (a ≥ 0، b > 0) في حدود safe integer. null لو خارجها. */
export function floorDiv(a: number, b: number): number | null {
  if (!safe(a) || !safe(b) || a < 0 || b <= 0 || !safe(a + b)) return null
  let q = Math.floor(a / b)
  // القسمة العشرية ممكن تغلط بواحد قرب الأعداد الصحيحة — تصحيح بالضرب الصحيح
  while (q > 0 && q * b > a) q -= 1
  while ((q + 1) * b <= a) q += 1
  return q
}

/** round(n / d) لأقرب عدد صحيح (النص لفوق) = floor((2n + d) / 2d). null لو خارج الحدود. */
export function roundDiv(numerator: number, denominator: number): number | null {
  if (!safe(numerator) || !safe(denominator) || numerator < 0 || denominator <= 0) return null
  const top = 2 * numerator + denominator
  const bottom = 2 * denominator
  if (!safe(top) || !safe(bottom)) return null
  return floorDiv(top, bottom)
}

/** تكلفة المتر بالقروش: round(cost × 100 / lengthCm). */
export function costPerMeter(costPiastres: number, lengthCm: number): number | null {
  if (!safe(costPiastres) || costPiastres < 0) return null
  const scaled = costPiastres * 100
  if (!safe(scaled)) return null
  return roundDiv(scaled, lengthCm)
}

/** تكلفة القطعة بالقروش: round(cost / quantity). */
export function costPerPiece(costPiastres: number, quantity: number): number | null {
  return roundDiv(costPiastres, quantity)
}

// ── ربط نتيجة المعاينة بالبنود ────────────────────────────────────

export type LotCost = {
  lotSequence: number
  baseCostPiastres: number
  allocatedExtrasPiastres: number
  allocatedDiscountPiastres: number
  landedCostPiastres: number
}

export type LineCosts = { lots: LotCost[]; landedTotalPiastres: number }

/**
 * دفعات المعاينة (أو دفعات المستند المرحّل) متجمّعة حسب رقم البند ومترتبة بالتسلسل.
 * التسلسل = ترتيب اللفّة في البند (أول لفّة = 1)، والتوزيع نفسه من الداتابيز بس.
 */
export function groupLotsByLine(lots: ReadonlyArray<LotCost & { lineNo: number }>): Map<number, LineCosts> {
  const map = new Map<number, LineCosts>()
  for (const lot of lots) {
    const entry = map.get(lot.lineNo) ?? { lots: [], landedTotalPiastres: 0 }
    entry.lots.push({
      lotSequence: lot.lotSequence,
      baseCostPiastres: lot.baseCostPiastres,
      allocatedExtrasPiastres: lot.allocatedExtrasPiastres,
      allocatedDiscountPiastres: lot.allocatedDiscountPiastres,
      landedCostPiastres: lot.landedCostPiastres,
    })
    entry.landedTotalPiastres += lot.landedCostPiastres
    map.set(lot.lineNo, entry)
  }
  for (const entry of map.values()) entry.lots.sort((a, b) => a.lotSequence - b.lotSequence)
  return map
}
