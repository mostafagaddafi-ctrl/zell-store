import { isPiece, lowestPricePerMeter, widthOptionsOf, type StoreProduct } from '@zell/core'

/**
 * SEO-BASICS (أمر المالك 2026-10-27): البيانات المنظّمة (schema.org JSON-LD) والمسارات القانونية (canonical).
 * عرض بس لجوجل: نفس الاسم والسعر والصور اللي الصفحة بتعرضها، من غير أي حساب جديد (الفلوس بتتحسب في الداتابيز).
 * الحالات: structuredData.cases.ts (suite seo).
 */

export type JsonLd = Record<string, unknown>

/** القرش ← جنيه كنص برقمين عشريين (schema.org: price رقم كنص). */
export function piastresToEgp(piastres: number): string {
  return (piastres / 100).toFixed(2)
}

/** المسارات القانونية للصفحات اللي في الـ sitemap (نسبية؛ metadataBase بيكمّلها لـ https://myzill.com). */
export const canonicalPath = {
  home: (): string => '/',
  product: (id: number): string => '/product/' + String(id),
  collection: (slug: string): string => '/collection/' + slug,
  collections: (): string => '/collections',
}

/** Product + Offer: السعر زي الصفحة (أكتر من عرض = أقل سعر)، بالمتر أو بالقطعة. */
export function productJsonLd(product: StoreProduct, siteUrl: string): JsonLd {
  const piece = isPiece(product)
  const multi = !piece && widthOptionsOf(product).length > 1
  const price = piastresToEgp(multi ? lowestPricePerMeter(product) : product.price_per_meter_piastres)
  const url = siteUrl + canonicalPath.product(product.id)
  const ld: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name_ar,
    sku: String(product.id),
    url,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'EGP',
      price,
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price,
        priceCurrency: 'EGP',
        referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: piece ? 'C62' : 'MTR' },
      },
    },
  }
  const images = (product.gallery ?? []).map((image) => image.url).filter((value) => value !== '')
  if (images.length > 0) ld['image'] = images
  if (product.description_ar) ld['description'] = product.description_ar
  if (product.brand) ld['brand'] = { '@type': 'Brand', name: product.brand }
  return ld
}

/** Organization + WebSite للمتجر (الاسم · الرابط · اللوجو من اللوحة · السوشيال). */
export function storeJsonLd(input: { name: string; siteUrl: string; logoUrl: string | null; sameAs: string[] }): JsonLd[] {
  const home = input.siteUrl + '/'
  const org: JsonLd = { '@context': 'https://schema.org', '@type': 'Organization', name: input.name, url: home }
  if (input.logoUrl) org['logo'] = input.logoUrl
  if (input.sameAs.length > 0) org['sameAs'] = input.sameAs
  return [org, { '@context': 'https://schema.org', '@type': 'WebSite', name: input.name, url: home }]
}

/** نص آمن جوه script من نوع ld+json: مفيش «<» أو «>» أو «&» حرفي، علشان أي نص من اللوحة مايقفلش الـ script. */
export function jsonLdText(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
