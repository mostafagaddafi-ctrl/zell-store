/**
 * STORE-MENU — حالات منطق القائمة والهيدر (pnpm --filter @zell/storefront cases، suite nav).
 * العقد: docs/contracts/STORE-MENU.md §١٠.
 */

import {
  DESKTOP_LINKS,
  buildDesktopNav,
  buildMobileMenu,
  cartBadge,
  cartLabel,
  collectionSlugOf,
  homeHelpVisibility,
  isHomeHelpSectionShown,
  menuActiveKey,
  normalizePath,
  type HomeHelpVisibility,
  type MobileMenuModel,
  type NavCollection,
} from './storeNav'

export type NavCaseFailure = { name: string; expected: string; actual: string }

const failures: NavCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const col = (slug: string, title = 'قسم ' + slug): NavCollection => ({ slug, title })
const cols = (count: number): NavCollection[] => Array.from({ length: count }, (_, i) => col('c' + String(i + 1)))
const AR = 'عازل-حرارة'
const AR_ENCODED = encodeURIComponent(AR)
const TOOLS = { href: '/installation-tools', label: 'أدوات التركيب' }
const BOTH: HomeHelpVisibility = { how: true, faq: true }
const NONE: HomeHelpVisibility = { how: false, faq: false }
const WA = 'https://wa.me/201000000000?text=x'

function menu(pathname: string | null | undefined, extra: Partial<Parameters<typeof buildMobileMenu>[0]> = {}): MobileMenuModel {
  return buildMobileMenu({
    pathname,
    allLabel: 'كل المنتجات',
    collections: [col('a'), col(AR), col('c')],
    toolsLink: TOOLS,
    help: BOTH,
    whatsappHref: WA,
    ...extra,
  })
}

/** كل الروابط المتعلّمة في القائمة (مفاتيحها). */
function currentKeys(model: MobileMenuModel): string[] {
  const items = [
    model.shortcuts.cart,
    model.shortcuts.track,
    model.all,
    ...model.collections,
    model.tools,
    model.help.how,
    model.help.faq,
    model.help.whatsapp,
    model.home,
  ]
  return items.filter((item) => item !== null && item.current).map((item) => (item === null ? '' : item.key))
}

function desktop(pathname: string | null | undefined, count: number, allLabel = 'كل المنتجات') {
  return buildDesktopNav({ pathname, allLabel, collections: cols(count) })
}

export function runStoreNavCases(): { passed: number; failures: NavCaseFailure[] } {
  // ── توحيد المسار ──
  check('P01 normalize: trailing slash · query · hash · root', [normalizePath('/products/'), normalizePath('/track?x=1'), normalizePath('/#faq'), normalizePath('/'), normalizePath('//')], [
    '/products',
    '/track',
    '/',
    '/',
    '/',
  ])
  check('P02 normalize: empty / null / undefined = no path', [normalizePath(''), normalizePath(null), normalizePath(undefined)], ['', '', ''])
  check('P03 collection slug: one segment only', [collectionSlugOf('/collection/a'), collectionSlugOf('/collection/'), collectionSlugOf('/collection/a/b'), collectionSlugOf('/collections')], [
    'a',
    null,
    null,
    null,
  ])

  // ── تمييز القائمة (§٤) ──
  const opts = { collections: [col('a'), col(AR)], hasAll: true, toolsHref: TOOLS.href }
  check('M01 / = home', menuActiveKey('/', opts), 'home')
  check('M02 /products and /products/ = all', [menuActiveKey('/products', opts), menuActiveKey('/products/', opts)], ['all', 'all'])
  check('M03 /products with hidden all link = nothing', menuActiveKey('/products', { ...opts, hasAll: false }), null)
  check('M04 collection in the list', menuActiveKey('/collection/a', opts), 'collection:a')
  check('M05 arabic slug: raw and encoded path', [menuActiveKey('/collection/' + AR, opts), menuActiveKey('/collection/' + AR_ENCODED, opts)], [
    'collection:' + AR,
    'collection:' + AR,
  ])
  check('M06 broken encoding = compared as is (no throw, no match)', menuActiveKey('/collection/%E0%A4%A', opts), null)
  check('M07 slug not in navCollections = nothing', menuActiveKey('/collection/zzz', opts), null)
  check('M08 /collections in the menu = nothing', menuActiveKey('/collections', opts), null)
  check('M09 tools · cart · track', [menuActiveKey('/installation-tools', opts), menuActiveKey('/cart', opts), menuActiveKey('/track', opts)], ['tools', 'cart', 'track'])
  check('M10 tools page without a tools link = nothing', menuActiveKey('/installation-tools', { ...opts, toolsHref: null }), null)
  check('M11 product · checkout · order · empty · null = nothing', [
    menuActiveKey('/product/5', opts),
    menuActiveKey('/checkout', opts),
    menuActiveKey('/order/FLM-ABC123', opts),
    menuActiveKey('', opts),
    menuActiveKey(null, opts),
  ], [null, null, null, null, null])

  // ── نموذج القائمة ──
  const atHome = menu('/')
  check('B01 /#how and /#faq never current (home is the current page)', [atHome.help.how?.current, atHome.help.faq?.current, atHome.home.current], [false, false, true])
  check('B02 at most one current link per page', [
    currentKeys(menu('/')),
    currentKeys(menu('/products')),
    currentKeys(menu('/collection/' + AR_ENCODED)),
    currentKeys(menu('/installation-tools')),
    currentKeys(menu('/cart')),
    currentKeys(menu('/track')),
    currentKeys(menu('/product/1')),
    currentKeys(menu('/#faq')),
  ], [['home'], ['all'], ['collection:' + AR], ['tools'], ['cart'], ['track'], [], ['home']])
  check('B03 order and labels', [
    atHome.shortcuts.cart.label,
    atHome.shortcuts.track.label,
    atHome.all?.label,
    atHome.collections.map((item) => item.href),
    atHome.tools?.label,
    atHome.help.how?.label,
    atHome.help.faq?.label,
    atHome.help.whatsapp?.label,
    atHome.home.label,
  ], [
    'السلة',
    'تتبّع طلبك',
    'كل المنتجات',
    ['/collection/a', '/collection/' + AR, '/collection/c'],
    'أدوات التركيب',
    'إزاي أطلب',
    'الأسئلة المتكررة',
    'تواصل على واتساب',
    'الرئيسية',
  ])
  check('B04 collections keep the input order and titles', menu('/', { collections: [col('z', 'زد'), col('a', 'ألف')] }).collections.map((item) => item.label), ['زد', 'ألف'])
  check('B05 empty allLabel = no all link', menu('/', { allLabel: '' }).all, null)
  check('B06 no collections = empty list (no heading)', menu('/', { collections: [] }).collections.length, 0)
  check('B07 no tools link = no tools (no divider)', menu('/', { toolsLink: null }).tools, null)
  check('B08 help conditions', [
    [menu('/', { help: { how: true, faq: false } }).help.how !== null, menu('/', { help: { how: true, faq: false } }).help.faq !== null],
    [menu('/', { help: { how: false, faq: true } }).help.how !== null, menu('/', { help: { how: false, faq: true } }).help.faq !== null],
  ], [
    [true, false],
    [false, true],
  ])
  check('B09 no whatsapp number = no whatsapp link', menu('/', { whatsappHref: null }).help.whatsapp, null)
  check('B10 help section hidden only when all three are missing', [
    menu('/', { help: NONE, whatsappHref: null }).showHelp,
    menu('/', { help: NONE }).showHelp,
    menu('/', { help: { how: false, faq: true }, whatsappHref: null }).showHelp,
  ], [false, true, true])
  check('B11 shortcuts always present (cart and track)', [menu(null, { collections: [], allLabel: '', toolsLink: null, help: NONE, whatsappHref: null }).shortcuts.cart.href, menu(null).shortcuts.track.href], [
    '/cart',
    '/track',
  ])

  // ── ترتيب الحركة ──
  const full = menu('/')
  const indexes = [
    full.shortcuts.cart.index,
    full.shortcuts.track.index,
    full.all?.index,
    ...full.collections.map((item) => item.index),
    full.tools?.index,
    full.help.how?.index,
    full.help.faq?.index,
    full.help.whatsapp?.index,
  ]
  check('A01 animation indexes sequential from 0 with no duplicates', indexes, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  const sparse = menu('/', { allLabel: '', toolsLink: null, help: { how: false, faq: true } })
  check('A02 sequential even with hidden parts', [sparse.shortcuts.cart.index, sparse.shortcuts.track.index, ...sparse.collections.map((item) => item.index), sparse.help.faq?.index, sparse.help.whatsapp?.index], [
    0, 1, 2, 3, 4, 5, 6,
  ])
  check('A03 home row is outside the animation', full.home.index, -1)

  // ── شرط الرئيسية (§٥) ──
  const content = (how: { visible: boolean; steps: number } | null, faq: { visible: boolean; items: number } | null) => ({
    homeSections: [
      { key: 'hero' as const, visible: true, title: '', subtitle: '' },
      ...(how === null ? [] : [{ key: 'how_it_works' as const, visible: how.visible, title: '', subtitle: '' }]),
      ...(faq === null ? [] : [{ key: 'faq' as const, visible: faq.visible, title: '', subtitle: '' }]),
    ],
    orderSteps: Array.from({ length: how?.steps ?? 0 }, () => ({ title: 't', description: 'd' })),
    faqs: Array.from({ length: faq?.items ?? 0 }, () => ({ question: 'q', answer: 'a' })),
  })
  check('H01 both shown', homeHelpVisibility(content({ visible: true, steps: 2 }, { visible: true, items: 1 })), { how: true, faq: true })
  check('H02 visible false', homeHelpVisibility(content({ visible: false, steps: 2 }, { visible: false, items: 1 })), { how: false, faq: false })
  check('H03 empty content', homeHelpVisibility(content({ visible: true, steps: 0 }, { visible: true, items: 0 })), { how: false, faq: false })
  check('H04 section missing from homeSections', homeHelpVisibility(content(null, null)), { how: false, faq: false })
  check('H05 hero/products are never help sections', [
    isHomeHelpSectionShown({ key: 'hero', visible: true }, { orderSteps: [{ title: 't', description: 'd' }], faqs: [{ question: 'q', answer: 'a' }] }),
    isHomeHelpSectionShown({ key: 'products', visible: true }, { orderSteps: [{ title: 't', description: 'd' }], faqs: [{ question: 'q', answer: 'a' }] }),
  ], [false, false])

  // ── هيدر الكمبيوتر: الـ overflow (§٤) ──
  check('D00 DESKTOP_LINKS unchanged', DESKTOP_LINKS, 4)
  check('D01 3 and 4 collections: all visible, no overflow', [
    [desktop('/', 3).links.length, desktop('/', 3).overflow],
    [desktop('/', 4).links.length, desktop('/', 4).overflow],
  ], [
    [3, null],
    [4, null],
  ])
  check('D02 5 and 8 collections: first 3 visible + overflow with the full count', [
    [desktop('/', 5).links.map((link) => link.slug), desktop('/', 5).overflow?.count],
    [desktop('/', 8).links.map((link) => link.slug), desktop('/', 8).overflow?.count],
  ], [
    [['c1', 'c2', 'c3'], 5],
    [['c1', 'c2', 'c3'], 8],
  ])
  const visibleCurrent = desktop('/collection/c2', 5)
  check('D03 current collection visible = it is current, overflow not tinted', [visibleCurrent.links.map((link) => link.current), visibleCurrent.overflow], [
    [false, true, false],
    { count: 5, current: false, containsCurrent: false },
  ])
  const hiddenCurrent = desktop('/collection/c4', 5)
  check('D04 4th collection hidden by overflow = overflow tinted, no aria-current anywhere', [hiddenCurrent.links.some((link) => link.current), hiddenCurrent.overflow], [
    false,
    { count: 5, current: false, containsCurrent: true },
  ])
  check('D05 4 collections exactly: the 4th is a visible link (no overflow)', [desktop('/collection/c4', 4).links.map((link) => link.current), desktop('/collection/c4', 4).overflow], [
    [false, false, false, true],
    null,
  ])
  check('D06 /collections = aria-current on overflow (only when it exists)', [desktop('/collections', 5).overflow?.current, desktop('/collections', 4).overflow], [true, null])
  check('D07 unknown slug = nothing marked', [desktop('/collection/zzz', 5).links.some((link) => link.current), desktop('/collection/zzz', 5).overflow?.containsCurrent], [false, false])
  check('D08 all · track · cart', [desktop('/products', 3).allCurrent, desktop('/products', 3, '').allCurrent, desktop('/track', 3).trackCurrent, desktop('/cart/', 3).cartCurrent, desktop('/', 3).trackCurrent], [
    true,
    false,
    true,
    true,
    false,
  ])

  // ── السلة ──
  check('C01 badge: not ready · 0 · 1 · 99 · 100', [cartBadge(false, 5), cartBadge(true, 0), cartBadge(true, 1), cartBadge(true, 99), cartBadge(true, 100)], [null, null, '1', '99', '99+'])
  check('C02 label (same wording as the header before the contract)', [cartLabel(false, 3), cartLabel(true, 0), cartLabel(true, 1), cartLabel(true, 2), cartLabel(true, 3), cartLabel(true, 11)], [
    'السلة',
    'السلة — فاضية',
    'السلة — فيها منتج واحد',
    'السلة — فيها منتجين',
    'السلة — فيها 3 منتجات',
    'السلة — فيها 11 منتج',
  ])

  return { passed, failures }
}
