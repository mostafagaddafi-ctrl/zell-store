import 'server-only'

import {
  CATALOG_INCOMPLETE_MESSAGE,
  catalogBlocksDocuments,
  loadViewCatalogWith,
  type CatalogProduct,
  type InventoryCatalog,
} from '../inventory/catalog'
import type { InventoryLocationOption } from '../inventory/purchases'
import type { InventorySupplier } from '../inventory/suppliers'
import { loadLocationOptions, loadSupplierOptions } from './inventoryPurchases'
import { readInventoryCatalog } from './reads'

/**
 * بيانات نموذج المستند (فاتورة الشراء) — عدد ثابت من الطلبات، من غير N+1:
 *   • الكتالوج: طلبين بـ exactCount (readInventoryCatalog).
 *   • الموردين النشطين والمخازن النشطة: صفحات keyset بحد أمان.
 *
 * 🔒 أي بيانات ناقصة أو مش مؤكدة (كتالوج غير complete، قايمة موردين/مخازن أكبر من الحد، أو فشل
 *    قراءة) بتوقف النموذج كله برسالة تشغيلية واضحة — مش بنبني payload من بيانات ناقصة.
 */

export type PurchaseEditorData =
  | { ok: true; catalog: CatalogProduct[]; suppliers: InventorySupplier[]; locations: InventoryLocationOption[] }
  | { ok: false; reasons: string[] }

const READ_FAILED = 'حصل خطأ في القراءة. حدّث الصفحة، ولو اتكرر بلّغ.'

export async function loadPurchaseEditorData(actor: string): Promise<PurchaseEditorData> {
  const [catalog, suppliers, locations] = await Promise.all([
    readInventoryCatalog().then(
      (value): InventoryCatalog | null => value,
      () => null,
    ),
    loadSupplierOptions(actor, false),
    loadLocationOptions(actor),
  ])

  const reasons: string[] = []

  if (catalog === null) reasons.push('قايمة المنتجات: ' + READ_FAILED)
  else if (catalogBlocksDocuments(catalog)) reasons.push(CATALOG_INCOMPLETE_MESSAGE)

  if (!suppliers.ok) reasons.push('الموردين: ' + (suppliers.code === 'INTERNAL' ? READ_FAILED : suppliers.message))
  else if (!suppliers.data.complete) reasons.push('قايمة الموردين النشطين أكبر من الحد (500)، فالنموذج واقف لحد ما تتظبط.')

  if (!locations.ok) reasons.push('المخازن: ' + (locations.code === 'INTERNAL' ? READ_FAILED : locations.message))
  else if (!locations.data.complete) reasons.push('قايمة المخازن أكبر من الحد (500)، فالنموذج واقف لحد ما تتظبط.')
  else if (locations.data.items.length === 0) reasons.push('مفيش مخزن نشط.')

  if (reasons.length > 0 || catalog === null || !suppliers.ok || !locations.ok) {
    return { ok: false, reasons: reasons.length > 0 ? reasons : [READ_FAILED] }
  }
  return { ok: true, catalog: catalog.products, suppliers: suppliers.data.items, locations: locations.data.items }
}

export type OpeningEditorData =
  | { ok: true; catalog: CatalogProduct[]; locations: InventoryLocationOption[] }
  | { ok: false; reasons: string[] }

/** بيانات نموذج رصيد أول المدة — نفس القواعد من غير موردين: الكتالوج (exactCount) والمخازن النشطة. */
export async function loadOpeningEditorData(actor: string): Promise<OpeningEditorData> {
  const [catalog, locations] = await Promise.all([
    readInventoryCatalog().then(
      (value): InventoryCatalog | null => value,
      () => null,
    ),
    loadLocationOptions(actor),
  ])

  const reasons: string[] = []
  if (catalog === null) reasons.push('قايمة المنتجات: ' + READ_FAILED)
  else if (catalogBlocksDocuments(catalog)) reasons.push(CATALOG_INCOMPLETE_MESSAGE)

  if (!locations.ok) reasons.push('المخازن: ' + (locations.code === 'INTERNAL' ? READ_FAILED : locations.message))
  else if (!locations.data.complete) reasons.push('قايمة المخازن أكبر من الحد (500)، فالنموذج واقف لحد ما تتظبط.')
  else if (locations.data.items.length === 0) reasons.push('مفيش مخزن نشط.')

  if (reasons.length > 0 || catalog === null || !locations.ok) {
    return { ok: false, reasons: reasons.length > 0 ? reasons : [READ_FAILED] }
  }
  return { ok: true, catalog: catalog.products, locations: locations.data.items }
}

/**
 * قايمة المنتجات للعرض بس (سعر البيع الحالي في المستند المرحّل) — نفس قراءة الكتالوج (طلبين).
 * فشل القراءة أو كتالوج incomplete/uncertain → null (loadViewCatalogWith)، والعرض بيكمّل من غير الأسعار.
 */
export function loadViewCatalog(): Promise<CatalogProduct[] | null> {
  return loadViewCatalogWith(readInventoryCatalog)
}
