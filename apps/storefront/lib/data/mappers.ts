/**
 * تحويل صفوف الداتابيز لأنواع @zell/core.
 *
 * الملف ده مالوش أي اتصال بشبكة — تحويل خالص، قابل للاختبار لوحده.
 * خارج نطاقه تمامًا: رفع أو حذف أو تعديل أي صورة، وأي SQL أو RLS.
 */
import {
  publicImageUrl,
  sanitizeAnnouncementHref,
  orderGovernorates,
  parseHomeProducts,
  parseShippingAreas,
  parseSocialLinks,
  catalogLayoutOf,
  parseInstallationToolsPage,
  parseInstallationConfig,
  DEFAULT_ADDONS_TITLE,
  DEFAULT_STORE_CONTENT,
  heroMobileLayoutOf,
  type HomeSection,
  type HomeSectionKey,
  type StoreContent,
  type Announcement,
  type StoreCollection,
  type StoreImage,
  type StoreProduct,
  type StoreSettings,
  type WidthOption,
} from '@zell/core'

/** صف جدول products. */
export type ProductRow = {
  id: number
  name_ar: string
  name_en: string | null
  brand: string | null
  description_ar: string | null
  image_url: string | null
  images: unknown
  before_image: string | null
  after_image: string | null
  price_per_meter_piastres: number
  width_cm: number
  lock_width: boolean
  compare_at_piastres: number | null
  sale_unit: string
  is_listed: boolean
  max_quantity: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
  short_benefit: string | null
  benefits: unknown
}

/**
 * صف public.product_images.
 * ترتيب الاستعلام: is_primary desc, sort_order asc, id asc
 */
export type ProductImageRow = {
  id: number
  product_id: number
  bucket: string
  object_path: string
  kind: 'gallery' | 'before' | 'after'
  alt_text: string | null
  sort_order: number
  is_primary: boolean
  width_px: number | null
  height_px: number | null
}

/** صف public.site_images — الفلتر: kind = 'logo' and is_active = true */
export type SiteImageRow = {
  id: number
  bucket: string
  object_path: string
  kind: string
  alt_text: string | null
  is_active: boolean
  width_px: number | null
  height_px: number | null
}

/** صف public.collections */
export type CollectionRow = {
  id: number
  slug: string
  title_ar: string
  subtitle_ar: string | null
  show_on_home: boolean
  show_in_nav: boolean
  sort_order: number
  cover_bucket: string | null
  cover_object_path: string | null
  cover_width_px: number | null
  cover_height_px: number | null
  catalog_layout: string | null
}

/** صف public.product_collections */
export type ProductCollectionRow = {
  collection_id: number
  product_id: number
  sort_order: number
}

/**
 * المجموعات + ربطها بالمنتجات.
 *
 * ⚠️ المنتجات اللي **مش** في قائمة المعروضة بتتشال من الربط. الربط
 *    بيتعمل على كل المنتجات في الداتابيز، لكن الاستعلام بيجيب
 *    is_active = true بس — فمنتج متوقّف لازم يختفي من المجموعة كمان،
 *    مش يبان كفراغ.
 *
 * ⚠️ المجموعة اللي بقيت فاضية بعد التصفية **بتتشال**. مجموعة بعنوان
 *    وصفر منتجات على الصفحة الرئيسية تبان كعطل.
 */
export function toStoreCollections(
  collectionRows: CollectionRow[],
  linkRows: ProductCollectionRow[],
  products: readonly StoreProduct[],
  supabaseUrl: string,
): StoreCollection[] {
  // products = المنتجات الظاهرة بس. منتج متوقّف مش هنا، فبيختفي من
  // القسم والربط نفسه بيفضل محفوظ في الداتابيز.
  const byProduct = new Map<number, StoreProduct>(products.map((product) => [product.id, product]))

  const byCollection = new Map<number, ProductCollectionRow[]>()
  for (const link of linkRows) {
    if (!byProduct.has(link.product_id)) continue
    const bucket = byCollection.get(link.collection_id)
    if (bucket) bucket.push(link)
    else byCollection.set(link.collection_id, [link])
  }

  const out: StoreCollection[] = []
  for (const row of collectionRows) {
    if (!row.show_on_home && !row.show_in_nav) continue
    const links = byCollection.get(row.id) ?? []
    // قسم فاضي مابيظهرش للزائر حتى لو مفعّل — اللوحة بتوضّح السبب
    if (links.length === 0) continue
    links.sort((a, b) => (a.sort_order - b.sort_order) || (a.product_id - b.product_id))
    const productIds = links.map((link) => link.product_id)
    const cover = toCollectionCover(row, supabaseUrl)
    out.push({
      id: row.id,
      slug: row.slug,
      title: row.title_ar,
      subtitle: row.subtitle_ar ?? '',
      productIds,
      showOnHome: row.show_on_home,
      showInNav: row.show_in_nav,
      image: cover ?? firstProductImage(productIds, byProduct),
      hasCover: cover !== null,
      catalogLayout: catalogLayoutOf(row.catalog_layout),
    })
  }
  return out
}

/** الغلاف المرفوع من اللوحة — kind بيتثبّت 'gallery' لنفس سبب toStoreSiteImage. */
function toCollectionCover(row: CollectionRow, supabaseUrl: string): StoreImage | null {
  if (!row.cover_bucket || !row.cover_object_path) return null
  return {
    id: row.id,
    url: publicImageUrl(supabaseUrl, { bucket: row.cover_bucket, object_path: row.cover_object_path }),
    alt: row.title_ar,
    width: row.cover_width_px,
    height: row.cover_height_px,
    kind: 'gallery',
    isPrimary: true,
  }
}

/** بديل الغلاف: أول صورة لأول منتج ظاهر بترتيب القسم. */
function firstProductImage(
  productIds: readonly number[],
  byProduct: ReadonlyMap<number, StoreProduct>,
): StoreImage | null {
  for (const id of productIds) {
    const image = byProduct.get(id)?.gallery[0]
    if (image) return image
  }
  return null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

export function toStoreImage(row: ProductImageRow, supabaseUrl: string, fallbackAlt: string): StoreImage {
  return {
    id: row.id,
    url: publicImageUrl(supabaseUrl, { bucket: row.bucket, object_path: row.object_path }),
    alt: row.alt_text && row.alt_text.trim() !== '' ? row.alt_text : fallbackAlt,
    width: row.width_px,
    height: row.height_px,
    kind: row.kind,
    isPrimary: row.is_primary,
  }
}

/**
 * صف site_images -> StoreImage.
 *
 * ⚠️ kind هنا بيتثبّت 'gallery' عن قصد: اتحاد StoreImage.kind بيوصف
 * أنواع **صور المنتجات** (gallery/before/after)، وصور الموقع
 * (logo/hero) مالهاش معنى في الاتحاد ده. توسيع الاتحاد كان هيجبر كل
 * مستهلك لصور المنتجات يتعامل مع حالات مستحيلة عنده.
 */
export function toStoreSiteImage(row: SiteImageRow, supabaseUrl: string, fallbackAlt: string): StoreImage {
  return {
    id: row.id,
    url: publicImageUrl(supabaseUrl, { bucket: row.bucket, object_path: row.object_path }),
    alt: row.alt_text && row.alt_text.trim() !== '' ? row.alt_text : fallbackAlt,
    width: row.width_px,
    height: row.height_px,
    kind: 'gallery',
    isPrimary: true,
  }
}

/** اسم محفوظ للتوافق — اللوجو حالة خاصة من صور الموقع. */
export function toStoreLogo(row: SiteImageRow, supabaseUrl: string, storeName: string): StoreImage {
  return toStoreSiteImage(row, supabaseUrl, storeName)
}

export function toStoreProduct(
  row: ProductRow,
  imageRows: ProductImageRow[],
  supabaseUrl: string,
): StoreProduct {
  const gallery = imageRows
    .filter((image) => image.product_id === row.id)
    .map((image) => toStoreImage(image, supabaseUrl, row.name_ar))

  return {
    id: row.id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    brand: row.brand,
    description_ar: row.description_ar,
    gallery,
    image_url: row.image_url,
    images: asStringArray(row.images),
    before_image: row.before_image,
    after_image: row.after_image,
    price_per_meter_piastres: row.price_per_meter_piastres,
    width_cm: row.width_cm,
    lock_width: row.lock_width === true,
    compare_at_piastres: row.compare_at_piastres ?? null,
    sale_unit: row.sale_unit === 'piece' ? 'piece' : 'meter',
    is_listed: row.is_listed !== false,
    max_quantity: typeof row.max_quantity === 'number' ? row.max_quantity : 20,
    min_length_cm: row.min_length_cm,
    step_cm: row.step_cm,
    max_length_cm: row.max_length_cm,
    // نصوص اللوحة زي ما هي — من غير أي تخمين من الاسم
    short_benefit: typeof row.short_benefit === 'string' && row.short_benefit.trim() !== '' ? row.short_benefit.trim() : null,
    benefits: asStringArray(row.benefits).map((point) => point.trim()),
  }
}

export function toStoreProducts(
  rows: ProductRow[],
  imageRows: ProductImageRow[],
  supabaseUrl: string,
): StoreProduct[] {
  return rows.map((row) => toStoreProduct(row, imageRows, supabaseUrl))
}

/** صف settings — مفتاح/قيمة. */
export type SettingRow = { key: string; value: unknown }

/**
 * ⚠️ المفاتيح العامة بس. المتجر **ما يستقبلش** notify_email ولا telegram_*.
 * القائمة دي بتتستخدم مرتين: في فلتر الاستعلام، وكحارس تاني وقت التحويل.
 */
export const PUBLIC_SETTING_KEYS = [
  'store_name',
  'logo_url',
  'offer_text',
  'offer_enabled',
  'installation',
  'shipping_order',
  'shipping_disabled_governorates',
  'shipping_areas',
  'home_products',
  'social_links',
  'addons_title',
  // صفحة «أدوات التركيب» — المحتوى بس، الربط من product_addons
  'installation_tools_page',
  // 0019 — مفتاح «أكواد الخصم» بس (true/false)، مش الأكواد نفسها
  'coupons_enabled',
  'whatsapp_number',
  'whatsapp_message',
  'shipping_rates',
  'shipping_default_piastres',
  'free_shipping_threshold_piastres',
  'announcement',
  // «المحتوى» من اللوحة
  'hero',
  'sections',
  'order_steps',
  'faqs',
  'footer_links',
  'trust_line',
] as const

function settingString(map: Map<string, unknown>, key: string, fallback = ''): string {
  const value = map.get(key)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return fallback
}

function settingNumber(map: Map<string, unknown>, key: string, fallback = 0): number {
  const value = map.get(key)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function settingRates(map: Map<string, unknown>, key: string): Record<string, number> {
  const value = map.get(key)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) out[name] = raw
    else if (typeof raw === 'string' && Number.isFinite(Number(raw)) && Number(raw) >= 0) out[name] = Number(raw)
  }
  return out
}

/**
 * الشريط — شكل دفاعي بالكامل. أي حقل ناقص أو بنوع غلط بيرجع لقيمته
 * الافتراضية، والرابط بيتفلتر تاني هنا مهما كان المحفوظ.
 */
function settingAnnouncement(map: Map<string, unknown>): Announcement {
  const empty: Announcement = { enabled: false, text: '', href: '', ctaLabel: '' }
  const raw = map.get('announcement')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return empty

  const value = raw as Record<string, unknown>
  const text = typeof value['text'] === 'string' ? value['text'].trim() : ''
  if (value['enabled'] !== true || text === '') return empty

  return {
    enabled: true,
    text,
    href: sanitizeAnnouncementHref(typeof value['href'] === 'string' ? value['href'] : ''),
    ctaLabel: typeof value['ctaLabel'] === 'string' ? value['ctaLabel'].trim() : '',
  }
}

export function toStoreSettings(rows: SettingRow[], logo: StoreImage | null = null): StoreSettings {
  const allowed = new Set<string>(PUBLIC_SETTING_KEYS)
  const map = new Map<string, unknown>()
  for (const row of rows) {
    if (allowed.has(row.key)) map.set(row.key, row.value)
  }

  const shippingRates = settingRates(map, 'shipping_rates')
  // المحافظة الموقوفة من اللوحة مابتظهرش في القايمة أصلًا (السيرفر بيرفضها كمان)
  const disabledRaw = map.get('shipping_disabled_governorates')
  const disabled = new Set(Array.isArray(disabledRaw) ? disabledRaw.filter((item): item is string => typeof item === 'string') : [])

  return {
    storeName: settingString(map, 'store_name', 'ZELL'),
    logo,
    /**
     * القيمة الحقيقية بتتحط في fetchStorefrontFromSupabase بعد ما
     * يتقرا صف site_images. هنا null كقيمة أساسية عشان الدالة دي
     * بتاخد الإعدادات بس — مابتعرفش حاجة عن الصور.
     */
    heroImage: null,
    logoUrl: settingString(map, 'logo_url'),
    offerText: settingString(map, 'offer_text'),
    offerEnabled: map.get('offer_enabled') !== false,
    installation: settingInstallation(map),
    whatsappNumber: settingString(map, 'whatsapp_number'),
    whatsappMessage: settingString(map, 'whatsapp_message'),
    shippingRates,
    shippingDefaultPiastres: settingNumber(map, 'shipping_default_piastres', 0),
    freeShippingThresholdPiastres: settingNumber(map, 'free_shipping_threshold_piastres', 0),
    governorates: orderGovernorates(
      Object.keys(shippingRates).filter((name) => !disabled.has(name)),
      Array.isArray(map.get('shipping_order'))
        ? (map.get('shipping_order') as unknown[]).filter((item): item is string => typeof item === 'string')
        : [],
    ),
    shippingAreas: parseShippingAreas(map.get('shipping_areas')),
    homeProducts: parseHomeProducts(map.get('home_products')),
    socialLinks: parseSocialLinks(map.get('social_links')),
    addonsTitle: settingString(map, 'addons_title').trim() || DEFAULT_ADDONS_TITLE,
    installationToolsPage: parseInstallationToolsPage(map.get('installation_tools_page')),
    // 0019 — jsonb true بالظبط (نفس فحص الداتابيز)؛ ناقص أو أي قيمة تانية = مقفولة
    couponsEnabled: map.get('coupons_enabled') === true,
    announcement: settingAnnouncement(map),
    content: settingContent(map),
  }
}

// ── «المحتوى» من اللوحة ───────────────────────────────────────
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.map(asObject).filter((item): item is Record<string, unknown> => item !== null)
}

const HOME_SECTION_KEYS: readonly HomeSectionKey[] = ['hero', 'products', 'how_it_works', 'faq']

/**
 * settings (hero · sections · order_steps · faqs · footer_links · trust_line)
 * -> StoreContent.
 *
 * ⚠️ إعداد مش موجود أو مش مقروء = القيمة الافتراضية (نفس النص القديم).
 *    لكن قايمة **محفوظة فاضية** (الأدمن مسح كل الأسئلة مثلًا) بتفضل فاضية
 *    والجزء بيستخبى — ده اختيار الأدمن مش عطل.
 */
function settingContent(map: Map<string, unknown>): StoreContent {
  const defaults = DEFAULT_STORE_CONTENT

  const heroRaw = asObject(map.get('hero'))
  const hero = heroRaw
    ? {
        title: cleanText(heroRaw['title']) || defaults.hero.title,
        accent: cleanText(heroRaw['accent']),
        subtitle: cleanText(heroRaw['subtitle']),
        ctaLabel: cleanText(heroRaw['ctaLabel']) || defaults.hero.ctaLabel,
      }
    : defaults.hero

  let homeSections: HomeSection[] = defaults.homeSections
  const sectionsRaw = map.get('sections')
  if (Array.isArray(sectionsRaw)) {
    const parsed: (HomeSection & { sortOrder: number })[] = []
    objects(sectionsRaw).forEach((item, index) => {
      const key = item['key']
      if (typeof key !== 'string' || !HOME_SECTION_KEYS.includes(key as HomeSectionKey)) return
      if (parsed.some((existing) => existing.key === key)) return
      const fallback = defaults.homeSections.find((section) => section.key === key)
      parsed.push({
        key: key as HomeSectionKey,
        visible: item['visible'] !== false,
        title: cleanText(item['title']) || (fallback ? fallback.title : ''),
        subtitle: cleanText(item['subtitle']),
        sortOrder: typeof item['sortOrder'] === 'number' ? item['sortOrder'] : index,
      })
    })
    // جزء مش متسجّل في الإعداد بيفضل ظاهر في آخر الصفحة بقيمه الافتراضية
    defaults.homeSections.forEach((section, index) => {
      if (!parsed.some((existing) => existing.key === section.key)) parsed.push({ ...section, sortOrder: 1000 + index })
    })
    parsed.sort((a, b) => a.sortOrder - b.sortOrder)
    homeSections = parsed.map(({ key, visible, title, subtitle }) => ({ key, visible, title, subtitle }))
  }

  const stepsRaw = map.get('order_steps')
  const orderSteps = Array.isArray(stepsRaw)
    ? objects(stepsRaw)
        .map((item) => ({ title: cleanText(item['title']), description: cleanText(item['description']) }))
        .filter((item) => item.title !== '')
    : defaults.orderSteps

  const faqsRaw = map.get('faqs')
  const faqs = Array.isArray(faqsRaw)
    ? objects(faqsRaw)
        .map((item) => ({ question: cleanText(item['question']), answer: cleanText(item['answer']) }))
        .filter((item) => item.question !== '' && item.answer !== '')
    : defaults.faqs

  const linksRaw = map.get('footer_links')
  const footerLinks = Array.isArray(linksRaw)
    ? objects(linksRaw)
        .map((item) => ({ label: cleanText(item['label']), href: sanitizeAnnouncementHref(cleanText(item['href'])) }))
        .filter((item) => item.label !== '')
    : defaults.footerLinks

  const trustRaw = map.get('trust_line')
  const trustLine = typeof trustRaw === 'string' ? trustRaw.trim() : defaults.trustLine

  // HOME-MOBILE — من عنصر hero في settings.sections (غايب أو غلط = compact)
  const heroMobileLayout = heroMobileLayoutOf(map.get('sections'))

  return { hero, homeSections, orderSteps, faqs, footerLinks, trustLine, heroMobileLayout }
}

/**
 * settings.installation -> فني التركيب (0018) بنفس قارئ اللوحة (@zell/core).
 * مش موجود أو مش مقروء = مقفول. سعر/انتقال بره حدود zell_create_order بيتشال هنا.
 */
function settingInstallation(map: Map<string, unknown>): StoreSettings['installation'] {
  const config = parseInstallationConfig(map.get('installation'))
  return { ...config, note: cleanText(config.note) }
}

// ── عروض الرول (0015) ─────────────────────────────────────────
/** صف public.product_widths — الشغّال بس، بترتيب sort_order. */
export type ProductWidthRow = {
  product_id: number
  width_cm: number
  price_per_meter_piastres: number
  compare_at_piastres: number | null
}

/** بيضيف العروض الإضافية لكل منتج. العرض اللي بيساوي الأساسي بيتشال. */
export function attachWidths(products: StoreProduct[], rows: ProductWidthRow[]): StoreProduct[] {
  if (rows.length === 0) return products
  const byProduct = new Map<number, WidthOption[]>()
  for (const row of rows) {
    const option: WidthOption = {
      width_cm: row.width_cm,
      price_per_meter_piastres: row.price_per_meter_piastres,
      compare_at_piastres: typeof row.compare_at_piastres === 'number' ? row.compare_at_piastres : null,
    }
    const list = byProduct.get(row.product_id)
    if (list) list.push(option)
    else byProduct.set(row.product_id, [option])
  }
  return products.map((product) => {
    const options = (byProduct.get(product.id) ?? []).filter((option) => option.width_cm !== product.width_cm)
    return options.length > 0 ? { ...product, width_options: options } : product
  })
}

// ── الإضافات (0016) ──────────────────────────────────────────
/** صف public.product_addons. */
export type ProductAddonRow = { product_id: number; addon_id: number; sort_order: number }

/** بيضيف addon_ids لمنتجات المتر — الإضافة لازم تكون منتج قطعة نشط. */
export function attachAddons(products: StoreProduct[], rows: ProductAddonRow[]): StoreProduct[] {
  if (rows.length === 0) return products
  const pieces = new Set(products.filter((product) => product.sale_unit === 'piece').map((product) => product.id))
  const byProduct = new Map<number, ProductAddonRow[]>()
  for (const row of rows) {
    if (!pieces.has(row.addon_id)) continue
    const list = byProduct.get(row.product_id)
    if (list) list.push(row)
    else byProduct.set(row.product_id, [row])
  }
  return products.map((product) => {
    const list = byProduct.get(product.id)
    if (!list || product.sale_unit === 'piece') return product
    list.sort((a, b) => a.sort_order - b.sort_order || a.addon_id - b.addon_id)
    return { ...product, addon_ids: list.map((row) => row.addon_id) }
  })
}
