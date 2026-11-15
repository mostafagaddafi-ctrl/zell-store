/**
 * SEO-BASICS — حالات البيانات المنظّمة والمسارات القانونية والأيقونات (pnpm --filter @zell/storefront cases، suite seo).
 * S01 القرش ← جنيه · S02 المسارات · S03 منتج بالمتر · S04 منتج بأكتر من عرض = أقل سعر · S05 القطعة · S06 الحقول الاختيارية ·
 * S07 نص الـ script آمن ويرجع نفس البيانات · S08 بيانات المتجر · S09 الأيقونات الثابتة (Z-ICON): favicon.ico ثم 48 و96 و192 ومن غير 32 (FAVICON-ORDER)،
 *   و180 لأبل، والـ manifest 192 و512، والملفات في public/، ومفيش مسارات مولّدة ولا إعادة توجيه.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StoreProduct } from '@zell/core'
import { canonicalPath, jsonLdText, piastresToEgp, productJsonLd, storeJsonLd } from './structuredData'
import { MANIFEST_ICONS, SITE_ICONS } from './icons'

export type SeoCaseFailure = { name: string; expected: string; actual: string }

const failures: SeoCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

function product(patch: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id: 7,
    name_ar: 'فيلم تجربة',
    name_en: null,
    brand: null,
    description_ar: null,
    width_cm: 120,
    lock_width: false,
    price_per_meter_piastres: 15000,
    compare_at_piastres: null,
    min_length_cm: 300,
    step_cm: 50,
    max_length_cm: 3000,
    gallery: [],
    image_url: null,
    images: [],
    before_image: null,
    after_image: null,
    ...patch,
  } as unknown as StoreProduct
}

const SITE = 'https://myzill.com'

export function runSeoCases(): { passed: number; failures: SeoCaseFailure[] } {
  check('S01 150000 piastres = 1500.00', piastresToEgp(150000), '1500.00')
  check('S01 12345 piastres = 123.45', piastresToEgp(12345), '123.45')

  check('S02 canonical paths', [canonicalPath.home(), canonicalPath.product(5), canonicalPath.collection('glass-films'), canonicalPath.collections()], [
    '/',
    '/product/5',
    '/collection/glass-films',
    '/collections',
  ])

  const meter = productJsonLd(product(), SITE) as Record<string, any>
  check('S03 meter product: type, name, sku, url', [meter['@type'], meter['name'], meter['sku'], meter['url']], ['Product', 'فيلم تجربة', '7', SITE + '/product/7'])
  check('S03 meter offer: EGP 150.00 per meter, in stock, new', [
    meter['offers']['priceCurrency'],
    meter['offers']['price'],
    meter['offers']['availability'],
    meter['offers']['itemCondition'],
    meter['offers']['priceSpecification']['referenceQuantity']['unitCode'],
  ], ['EGP', '150.00', 'https://schema.org/InStock', 'https://schema.org/NewCondition', 'MTR'])

  const multi = productJsonLd(
    product({ width_options: [{ width_cm: 150, price_per_meter_piastres: 12000, compare_at_piastres: null }] } as Partial<StoreProduct>),
    SITE,
  ) as Record<string, any>
  check('S04 more than one width = lowest price (like the page)', multi['offers']['price'], '120.00')

  const piece = productJsonLd(product({ sale_unit: 'piece', price_per_meter_piastres: 2500 } as Partial<StoreProduct>), SITE) as Record<string, any>
  check('S05 piece product: unit price, unitCode C62', [piece['offers']['price'], piece['offers']['priceSpecification']['referenceQuantity']['unitCode']], ['25.00', 'C62'])

  check('S06 no image/description/brand when empty', ['image' in meter, 'description' in meter, 'brand' in meter], [false, false, false])
  const full = productJsonLd(
    product({
      description_ar: 'وصف',
      brand: 'ماركة',
      gallery: [{ id: 1, url: 'https://x.supabase.co/a.jpg', alt: '', width: null, height: null, kind: 'gallery', isPrimary: true }],
    } as Partial<StoreProduct>),
    SITE,
  ) as Record<string, any>
  check('S06 image/description/brand when present', [full['image'], full['description'], full['brand']], [
    ['https://x.supabase.co/a.jpg'],
    'وصف',
    { '@type': 'Brand', name: 'ماركة' },
  ])

  const tricky = productJsonLd(product({ name_ar: 'a</script><b>&' } as Partial<StoreProduct>), SITE)
  const text = jsonLdText(tricky)
  check('S07 script text has no raw < > &', /[<>&]/.test(text), false)
  check('S07 script text parses back to the same data', JSON.parse(text), tricky)

  const store = storeJsonLd({ name: 'myzill', siteUrl: SITE, logoUrl: 'https://x.supabase.co/logo.png', sameAs: ['https://facebook.com/myzill'] })
  check('S08 Organization + WebSite', store.map((item) => [item['@type'], item['name'], item['url']]), [
    ['Organization', 'myzill', SITE + '/'],
    ['WebSite', 'myzill', SITE + '/'],
  ])
  check('S08 logo and sameAs', [store[0]?.['logo'], store[0]?.['sameAs']], ['https://x.supabase.co/logo.png', ['https://facebook.com/myzill']])
  const bare = storeJsonLd({ name: 'myzill', siteUrl: SITE, logoUrl: null, sameAs: [] })
  check('S08 no logo/sameAs when empty', ['logo' in (bare[0] ?? {}), 'sameAs' in (bare[0] ?? {})], [false, false])

  // S09 — Z-ICON (2026-11-15): أيقونات ثابتة في public/ بعناوين ثابتة؛ FAVICON-ORDER: أول PNG معلن 48 ومن غير 32
  check(
    'S09 declared icons: favicon.ico then 48, 96, 192 (no 16/32 declared), apple 180',
    [SITE_ICONS.icon.map((entry) => entry.url), SITE_ICONS.apple.map((entry) => entry.url)],
    [['/favicon.ico', '/icon-48.png', '/icon-96.png', '/icon-192.png'], ['/icon-180.png']],
  )
  check('S09 manifest icons: 192 and 512', MANIFEST_ICONS.map((entry) => entry.src), ['/icon-192.png', '/icon-512.png'])
  check(
    'S09 static URLs without ?hash',
    [...SITE_ICONS.icon.map((entry) => entry.url), ...SITE_ICONS.apple.map((entry) => entry.url), ...MANIFEST_ICONS.map((entry) => entry.src)].every((url) => !url.includes('?')),
    true,
  )
  const ICON_FILES = ['favicon.ico', 'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-96.png', 'icon-180.png', 'icon-192.png', 'icon-512.png']
  check('S09 the 8 static icon files are in public/', ICON_FILES.map((file) => existsSync(join(process.cwd(), 'public', file))), ICON_FILES.map(() => true))
  check(
    'S09 generated icon routes removed (app/icon.tsx, app/apple-icon.tsx)',
    [existsSync(join(process.cwd(), 'app', 'icon.tsx')), existsSync(join(process.cwd(), 'app', 'apple-icon.tsx'))],
    [false, false],
  )
  const config = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8')
  check('S09 no /favicon.ico rewrite (served from public/)', [config.includes("source: '/favicon.ico'"), config.includes('/icon/48')], [false, false])
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8')
  check('S09 the layout metadata declares SITE_ICONS', layout.includes('icons: SITE_ICONS'), true)

  return { passed, failures }
}
