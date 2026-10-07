/**
 * البحث عن المنتج في نماذج المخزون — منطق خالص.
 *
 * normalizeArabicSearch: بيشيل التشكيل والتطويل، ويوحّد أ/إ/آ/ٱ → ا، ى → ي، ة → ه، وبيصغّر الحروف
 * اللاتيني ويضم المسافات. البحث بيطابق كل كلمة من البحث جوه الاسم (بأي ترتيب).
 * القايمة بتتفلتر بوحدة البيع حسب نوع البند (لفّات → متر، قطع → قطعة)، وبترتيب الكتالوج.
 */

import type { CatalogProduct, SaleUnit } from './catalog'

export function normalizeArabicSearch(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function filterProducts(products: readonly CatalogProduct[], unit: SaleUnit, query: string): CatalogProduct[] {
  const tokens = normalizeArabicSearch(query).split(' ').filter((token) => token !== '')
  return products.filter((product) => {
    if (product.saleUnit !== unit) return false
    if (tokens.length === 0) return true
    const name = normalizeArabicSearch(product.nameAr)
    return tokens.every((token) => name.includes(token))
  })
}

export function productOptionLabel(product: CatalogProduct): string {
  return product.nameAr + (product.isActive ? '' : ' (موقوف)')
}
