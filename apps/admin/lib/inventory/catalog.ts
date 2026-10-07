/**
 * كتالوج نماذج المخزون (المنتجات + العروض المسموحة) — منطق خالص.
 *
 * القراءة نفسها في lib/data/reads.ts (readInventoryCatalog): طلبين ثابتين بـ exactCount، من
 * جداول الكتالوج (products / product_widths) — مش جداول 0020. فيها سعر البيع العام بس (PR-D: مرجعية
 * للمالك جنب التكلفة، وبيتعدّل من صفحة المنتج بس)، ومن غير أي عمود تكلفة.
 *
 * 🔒 منع الكتالوج الناقص بصمت (ملحق المراجعة · 1):
 *   • total = null            → uncertain (مش مؤكد)
 *   • total > عدد الصفوف       → incomplete (PostgREST أو الحد قصّ النتيجة)
 *   • total < عدد الصفوف       → uncertain (رد غير منطقي)
 *   • أي وحدة بيع غير meter/piece → المنتج بيتشال والحالة uncertain
 *   • أي سعر مش صالح (PR-D · مراجعة 2) → الصف بيتشال والحالة uncertain:
 *       products.price_per_meter_piastres       integer > 0 و ≤ 2147483647 (integer في schema.sql)
 *       product_widths.price_per_meter_piastres integer > 0 و ≤ 100000000 (check في 0015)
 *     مفقود / null / نص / صفر / سالب / كسر / خارج الحد = مش صالح. مفيش تحويل نص لرقم.
 *   مش بنعتمد على rows.length === limit لوحده.
 *   أي حالة غير complete بتوقف إنشاء وتعديل المستندات (catalogBlocksDocuments)، وبتخفي أسعار
 *   البيع من العرض المرحّل (loadViewCatalogWith → null).
 *
 * العروض المسموحة = width_cm الأساسي ∪ العروض الفعالة — نفس zell_inv_width_allowed بالظبط.
 * المنتجات الموقوفة بتظهر (0020 بيسمح بشرائها).
 */

export const CATALOG_PRODUCTS_LIMIT = 500
export const CATALOG_WIDTHS_LIMIT = 5000

/** حد الداتابيز لسعر المنتج: عمود integer (int4) مع check > 0. */
export const PRODUCT_PRICE_MAX_PIASTRES = 2147483647
/** حد الداتابيز لسعر العرض الإضافي: check (> 0 and <= 100000000) في 0015. */
export const WIDTH_PRICE_MAX_PIASTRES = 100000000

/** السعر جاي من الشبكة: نوعه unknown لحد ما يتفحص (isValidCatalogPrice). */
export type CatalogProductRow = {
  id: number
  name_ar: string
  sale_unit: string
  width_cm: number | null
  price_per_meter_piastres: unknown
  is_active: boolean
  sort_order: number
}

/** عروض product_widths **الفعالة بس** (القراءة بتفلتر is_active). */
export type CatalogWidthRow = { product_id: number; width_cm: number; price_per_meter_piastres: unknown }

/** عرض إضافي فعّال بسعره (سعر البيع للمتر في العرض ده). */
export type WidthOption = { widthCm: number; pricePerMeterPiastres: number }

export type CatalogCompleteness = 'complete' | 'uncertain' | 'incomplete'

export type SaleUnit = 'meter' | 'piece'

export type CatalogProduct = {
  id: number
  nameAr: string
  saleUnit: SaleUnit
  isActive: boolean
  baseWidthCm: number | null
  /** سعر البيع الحالي: للمتر في العرض الأساسي، أو سعر القطعة. */
  basePricePiastres: number
  allowedWidthsCm: number[]
  /** العروض الإضافية الفعالة بأسعارها (الموقوفة مش هنا). */
  widthOptions: WidthOption[]
}

export type InventoryCatalog = {
  status: CatalogCompleteness
  products: CatalogProduct[]
  /** منتجات اتشالت لأن وحدة بيعها مش معروفة. */
  skippedProducts: number
  /** صفوف (منتجات أو عروض) اتشالت لأن سعرها مش صالح. */
  invalidPrices: number
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

/** سعر صالح: رقم صحيح (مش نص) أكبر من صفر وفي حدود الداتابيز. */
export function isValidCatalogPrice(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max
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
  let invalidPrices = 0
  const byProduct = new Map<number, WidthOption[]>()
  for (const row of widths) {
    if (!isPositiveWidth(row.width_cm)) continue
    const price = row.price_per_meter_piastres
    if (!isValidCatalogPrice(price, WIDTH_PRICE_MAX_PIASTRES)) {
      invalidPrices += 1
      continue
    }
    const option: WidthOption = { widthCm: row.width_cm, pricePerMeterPiastres: price }
    const list = byProduct.get(row.product_id)
    if (list) list.push(option)
    else byProduct.set(row.product_id, [option])
  }

  const out: CatalogProduct[] = []
  let skipped = 0
  for (const row of products) {
    if (row.sale_unit !== 'meter' && row.sale_unit !== 'piece') {
      skipped += 1
      continue
    }
    const price = row.price_per_meter_piastres
    if (!isValidCatalogPrice(price, PRODUCT_PRICE_MAX_PIASTRES)) {
      invalidPrices += 1
      continue
    }
    const options = [...(byProduct.get(row.id) ?? [])].sort((a, b) => a.widthCm - b.widthCm)
    out.push({
      id: row.id,
      nameAr: row.name_ar,
      saleUnit: row.sale_unit,
      isActive: row.is_active,
      baseWidthCm: row.width_cm,
      basePricePiastres: price,
      allowedWidthsCm: allowedWidths(
        row.width_cm,
        options.map((option) => option.widthCm),
      ),
      widthOptions: options,
    })
  }

  return {
    status: skipped > 0 || invalidPrices > 0 ? combineCompleteness(status, 'uncertain') : status,
    products: out,
    skippedProducts: skipped,
    invalidPrices,
  }
}

export function catalogBlocksDocuments(catalog: InventoryCatalog): boolean {
  return catalog.status !== 'complete'
}

/**
 * قايمة المنتجات للعرض المرحّل (سعر البيع الحالي) — نفس قاعدة النماذج بالظبط:
 * فشل القراءة (رفض أو throw) أو كتالوج incomplete/uncertain → null، والعرض بيبيّن إن الأسعار مش ظاهرة.
 * ممنوع نعرض أسعار من كتالوج مش مؤكد كأنها كاملة.
 */
export async function loadViewCatalogWith(read: () => Promise<InventoryCatalog>): Promise<CatalogProduct[] | null> {
  let catalog: InventoryCatalog
  try {
    catalog = await read()
  } catch {
    return null
  }
  return catalogBlocksDocuments(catalog) ? null : catalog.products
}
