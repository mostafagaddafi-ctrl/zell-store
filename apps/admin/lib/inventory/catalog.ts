/**
 * كتالوج نماذج المخزون (المنتجات + العروض المسموحة) — منطق خالص.
 *
 * القراءة نفسها في lib/data/reads.ts (readInventoryCatalog): طلبين ثابتين بـ exactCount، من
 * جداول الكتالوج (products / product_widths) — مش جداول 0020، ومن غير أي عمود سعر أو تكلفة.
 *
 * 🔒 منع الكتالوج الناقص بصمت (ملحق المراجعة · 1):
 *   • total = null            → uncertain (مش مؤكد)
 *   • total > عدد الصفوف       → incomplete (PostgREST أو الحد قصّ النتيجة)
 *   • total < عدد الصفوف       → uncertain (رد غير منطقي)
 *   • أي وحدة بيع غير meter/piece → المنتج بيتشال والحالة uncertain
 *   مش بنعتمد على rows.length === limit لوحده.
 *   أي حالة غير complete بتوقف إنشاء وتعديل المستندات (catalogBlocksDocuments).
 *
 * العروض المسموحة = width_cm الأساسي ∪ العروض الفعالة — نفس zell_inv_width_allowed بالظبط.
 * المنتجات الموقوفة بتظهر (0020 بيسمح بشرائها).
 */

export const CATALOG_PRODUCTS_LIMIT = 500
export const CATALOG_WIDTHS_LIMIT = 5000

export type CatalogProductRow = {
  id: number
  name_ar: string
  sale_unit: string
  width_cm: number | null
  is_active: boolean
  sort_order: number
}

export type CatalogWidthRow = { product_id: number; width_cm: number }

export type CatalogCompleteness = 'complete' | 'uncertain' | 'incomplete'

export type SaleUnit = 'meter' | 'piece'

export type CatalogProduct = {
  id: number
  nameAr: string
  saleUnit: SaleUnit
  isActive: boolean
  baseWidthCm: number | null
  allowedWidthsCm: number[]
}

export type InventoryCatalog = {
  status: CatalogCompleteness
  products: CatalogProduct[]
  /** منتجات اتشالت لأن وحدة بيعها مش معروفة. */
  skippedProducts: number
}

export const CATALOG_INCOMPLETE_MESSAGE =
  'قايمة المنتجات اللي وصلت ناقصة أو مش مؤكدة، فإنشاء وتعديل المستندات واقف لحد ما تتقري كاملة. حدّث الصفحة، ولو اتكررت بلّغ.'

export function assessCompleteness(rowCount: number, total: number | null): CatalogCompleteness {
  if (total === null || !Number.isFinite(total)) return 'uncertain'
  if (total > rowCount) return 'incomplete'
  if (total < rowCount) return 'uncertain'
  return 'complete'
}

const RANK: Record<CatalogCompleteness, number> = { complete: 0, uncertain: 1, incomplete: 2 }

/** الأسوأ من الاتنين. */
export function combineCompleteness(a: CatalogCompleteness, b: CatalogCompleteness): CatalogCompleteness {
  return RANK[a] >= RANK[b] ? a : b
}

function isPositiveWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function allowedWidths(baseWidthCm: number | null, activeWidthsCm: readonly number[]): number[] {
  const set = new Set<number>()
  if (isPositiveWidth(baseWidthCm)) set.add(baseWidthCm)
  for (const width of activeWidthsCm) if (isPositiveWidth(width)) set.add(width)
  return [...set].sort((a, b) => a - b)
}

export function buildCatalog(
  products: readonly CatalogProductRow[],
  widths: readonly CatalogWidthRow[],
  status: CatalogCompleteness,
): InventoryCatalog {
  const byProduct = new Map<number, number[]>()
  for (const row of widths) {
    const list = byProduct.get(row.product_id)
    if (list) list.push(row.width_cm)
    else byProduct.set(row.product_id, [row.width_cm])
  }

  const out: CatalogProduct[] = []
  let skipped = 0
  for (const row of products) {
    if (row.sale_unit !== 'meter' && row.sale_unit !== 'piece') {
      skipped += 1
      continue
    }
    out.push({
      id: row.id,
      nameAr: row.name_ar,
      saleUnit: row.sale_unit,
      isActive: row.is_active,
      baseWidthCm: row.width_cm,
      allowedWidthsCm: allowedWidths(row.width_cm, byProduct.get(row.id) ?? []),
    })
  }

  return {
    status: skipped > 0 ? combineCompleteness(status, 'uncertain') : status,
    products: out,
    skippedProducts: skipped,
  }
}

export function catalogBlocksDocuments(catalog: InventoryCatalog): boolean {
  return catalog.status !== 'complete'
}
