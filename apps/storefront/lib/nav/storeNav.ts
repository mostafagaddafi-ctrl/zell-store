import type { HomeSection, HomeSectionKey, StoreContent } from '@zell/core'

/**
 * STORE-MENU — منطق خالص لقائمة الموبايل وهيدر الكمبيوتر (docs/contracts/STORE-MENU.md). من غير I/O.
 *
 * - §٤ تمييز الصفحة الحالية: من المسار بعد توحيده (من غير # ولا ? ولا الشرطة في الآخر، والـ slug بيتفك بأمان).
 *   روابط /#how و/#faq عمرها ما بتتعلّم، و«كل الأقسام» مابياخدش aria-current غير على /collections.
 * - §٥ شرط واحد لظهور «إزاي أطلب» و«الأسئلة المتكررة»: الرئيسية (page.tsx) والقائمة بيستخدموه هو بس.
 * - هيدر الكمبيوتر: لو الأقسام أكتر من DESKTOP_LINKS، أول (DESKTOP_LINKS - 1) ظاهرين + «كل الأقسام».
 */

/** عدد روابط الأقسام في هيدر الكمبيوتر قبل «كل الأقسام» (نفس القيمة اللي كانت في SiteHeader). */
export const DESKTOP_LINKS = 4

/** عدد الأقسام الظاهرة في قائمة الموبايل قبل «عرض كل الأقسام» (قرار المالك بعد المعاينة — STORE-MENU §١٥). */
export const MENU_VISIBLE_SECTIONS = 6

export const CART_HREF = '/cart'
export const TRACK_HREF = '/track'
export const HOW_HREF = '/#how'
export const FAQ_HREF = '/#faq'

export type NavCollection = { slug: string; title: string }

// ── §٥ ظهور روابط المساعدة ─────────────────────────────────────────

export type HomeHelpVisibility = { how: boolean; faq: boolean }

/** قسم «إزاي أطلب» أو «الأسئلة المتكررة» ظاهر في الرئيسية: visible ومحتواه مش فاضي. أي مفتاح تاني = false. */
export function isHomeHelpSectionShown(
  section: Pick<HomeSection, 'key' | 'visible'>,
  content: Pick<StoreContent, 'orderSteps' | 'faqs'>,
): boolean {
  if (!section.visible) return false
  if (section.key === 'how_it_works') return content.orderSteps.length > 0
  if (section.key === 'faq') return content.faqs.length > 0
  return false
}

/** القسم مش موجود في homeSections = مش ظاهر = الرابط مخفي. */
export function homeHelpVisibility(content: Pick<StoreContent, 'homeSections' | 'orderSteps' | 'faqs'>): HomeHelpVisibility {
  const shown = (key: HomeSectionKey) =>
    content.homeSections.some((section) => section.key === key && isHomeHelpSectionShown(section, content))
  return { how: shown('how_it_works'), faq: shown('faq') }
}

// ── المسار ──────────────────────────────────────────────────────────

/** من غير # ولا ? ولا الشرطة في الآخر. '' لو مفيش مسار. */
export function normalizePath(pathname: string | null | undefined): string {
  if (typeof pathname !== 'string') return ''
  const bare = (pathname.split('#')[0] ?? '').split('?')[0] ?? ''
  if (bare === '') return ''
  const trimmed = bare.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** الـ slug من /collection/<slug> (جزء واحد بس)، وإلا null. */
export function collectionSlugOf(path: string): string | null {
  const prefix = '/collection/'
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  if (rest === '' || rest.includes('/')) return null
  return rest
}

/** القسم اللي الـ slug بتاعه = slug المسار (مشفّر أو لأ)، من القايمة اللي اتبعتت بس. */
export function findCollection<T extends NavCollection>(collections: readonly T[], pathSlug: string | null): T | null {
  if (pathSlug === null) return null
  const wanted = safeDecode(pathSlug)
  return collections.find((collection) => collection.slug === pathSlug || safeDecode(collection.slug) === wanted) ?? null
}

// ── قائمة الموبايل ──────────────────────────────────────────────────

/** مفتاح الرابط المتعلّم في القائمة: home · all · cart · track · tools · collection:<slug> — أو null. */
export function menuActiveKey(
  pathname: string | null | undefined,
  options: { collections: readonly NavCollection[]; hasAll: boolean; toolsHref: string | null },
): string | null {
  const path = normalizePath(pathname)
  if (path === '/') return 'home'
  if (path === '/products') return options.hasAll ? 'all' : null
  if (path === CART_HREF) return 'cart'
  if (path === TRACK_HREF) return 'track'
  if (options.toolsHref !== null && path === normalizePath(options.toolsHref)) return 'tools'
  const match = findCollection(options.collections, collectionSlugOf(path))
  return match === null ? null : 'collection:' + match.slug
}

/** index = ترتيب حركة الظهور (--i)، متتالي من 0. */
export type MenuItem = { key: string; href: string; label: string; current: boolean; index: number }

export type MobileMenuModel = {
  shortcuts: { cart: MenuItem; track: MenuItem }
  all: MenuItem | null
  collections: MenuItem[]
  tools: MenuItem | null
  help: { how: MenuItem | null; faq: MenuItem | null; whatsapp: MenuItem | null }
  /** عنوان «المساعدة» والجزء كله بيختفوا لو مفيش ولا رابط. */
  showHelp: boolean
  /** أول عنصر في التصفّح (§١٥). */
  home: MenuItem
  /** «عرض كل الأقسام»: أول visibleCount ظاهرين، والباقي ورا الزرار؛ startExpanded = القسم الحالي من المخفيين. */
  moreSections: { visibleCount: number; hiddenCount: number; startExpanded: boolean }
}

export function buildMobileMenu(input: {
  pathname: string | null | undefined
  allLabel: string
  collections: readonly NavCollection[]
  toolsLink: { href: string; label: string } | null
  help: HomeHelpVisibility
  whatsappHref: string | null
}): MobileMenuModel {
  const active = menuActiveKey(input.pathname, {
    collections: input.collections,
    hasAll: Boolean(input.allLabel),
    toolsHref: input.toolsLink === null ? null : input.toolsLink.href,
  })
  let index = 0
  const item = (key: string, href: string, label: string): MenuItem => ({ key, href, label, current: active === key, index: index++ })

  const cart = item('cart', CART_HREF, 'السلة')
  const track = item('track', TRACK_HREF, 'تتبّع طلبك')
  // الرئيسية أول التصفّح (قرار المالك بعد المعاينة — STORE-MENU §١٥)
  const home = item('home', '/', 'الرئيسية')
  const all = input.allLabel ? item('all', '/products', input.allLabel) : null
  const collections = input.collections.map((collection) =>
    item('collection:' + collection.slug, '/collection/' + collection.slug, collection.title),
  )
  const tools = input.toolsLink === null ? null : item('tools', input.toolsLink.href, input.toolsLink.label)
  // مفاتيح how / faq / whatsapp عمرها ما بتساوي active، فمابتتعلّمش أبدًا
  const how = input.help.how ? item('how', HOW_HREF, 'إزاي أطلب') : null
  const faq = input.help.faq ? item('faq', FAQ_HREF, 'الأسئلة المتكررة') : null
  const whatsapp = input.whatsappHref ? item('whatsapp', input.whatsappHref, 'تواصل على واتساب') : null
  const hiddenCount = Math.max(0, collections.length - MENU_VISIBLE_SECTIONS)
  const moreSections = {
    visibleCount: hiddenCount > 0 ? MENU_VISIBLE_SECTIONS : collections.length,
    hiddenCount,
    startExpanded: collections.slice(MENU_VISIBLE_SECTIONS).some((section) => section.current),
  }

  return {
    shortcuts: { cart, track },
    all,
    collections,
    tools,
    help: { how, faq, whatsapp },
    showHelp: how !== null || faq !== null || whatsapp !== null,
    home,
    moreSections,
  }
}

// ── هيدر الكمبيوتر ──────────────────────────────────────────────────

export type DesktopLink = { slug: string; title: string; href: string; current: boolean }

export type DesktopNav = {
  allCurrent: boolean
  links: DesktopLink[]
  /** «كل الأقسام» — بس لو الأقسام أكتر من DESKTOP_LINKS. current = aria-current (/collections بس)، containsCurrent = تلوين خفيف. */
  overflow: { count: number; current: boolean; containsCurrent: boolean } | null
  trackCurrent: boolean
  cartCurrent: boolean
}

export function buildDesktopNav(input: {
  pathname: string | null | undefined
  allLabel: string
  collections: readonly NavCollection[]
}): DesktopNav {
  const path = normalizePath(input.pathname)
  const hasOverflow = input.collections.length > DESKTOP_LINKS
  const visible = hasOverflow ? input.collections.slice(0, DESKTOP_LINKS - 1) : input.collections.slice()
  const hidden = hasOverflow ? input.collections.slice(DESKTOP_LINKS - 1) : []
  const current = findCollection(input.collections, collectionSlugOf(path))

  return {
    allCurrent: Boolean(input.allLabel) && path === '/products',
    links: visible.map((collection) => ({
      slug: collection.slug,
      title: collection.title,
      href: '/collection/' + collection.slug,
      current: current !== null && current.slug === collection.slug,
    })),
    overflow: hasOverflow
      ? {
          count: input.collections.length,
          current: path === '/collections',
          containsCurrent: current !== null && hidden.some((collection) => collection.slug === current.slug),
        }
      : null,
    trackCurrent: path === TRACK_HREF,
    cartCurrent: path === CART_HREF,
  }
}

// ── السلة ───────────────────────────────────────────────────────────

/** رقم السلة: مايظهرش قبل ما السلة تجهز أو لو صفر، و99+ فوق 99. */
export function cartBadge(ready: boolean, count: number): string | null {
  if (!ready || !(count > 0)) return null
  return count > 99 ? '99+' : String(count)
}

/** «منتج واحد» · «منتجين» · «٣ منتجات» (٣–١٠) · «١١ منتج» (١١+). العدد الحقيقي — من غير 99+. (اتنقلت من SiteHeader بالحرف) */
export function itemsPhrase(count: number): string {
  if (count === 1) return 'منتج واحد'
  if (count === 2) return 'منتجين'
  if (count <= 10) return String(count) + ' منتجات'
  return String(count) + ' منتج'
}

/** اسم رابط السلة لقارئ الشاشة (نفس صياغة الهيدر قبل العقد). */
export function cartLabel(ready: boolean, count: number): string {
  if (!ready) return 'السلة'
  return count === 0 ? 'السلة — فاضية' : 'السلة — فيها ' + itemsPhrase(count)
}
