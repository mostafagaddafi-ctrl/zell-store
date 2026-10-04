/**
 * أنواع مشتركة بين متجر Next.js وداشبورد Retool.
 * مطابقة لأعمدة الداتابيز — الفلوس بالقرش، الأطوال بالسنتيمتر، كلها integer.
 */

export type ProductRules = {
  price_per_meter_piastres: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
}

/**
 * صورة جاهزة للعرض. الرابط بيتركّب في طبقة السيرفر من bucket + object_path،
 * فالواجهة ما بتعرفش حاجة عن تخزين الملفات.
 */
export type StoreImage = {
  id: number
  url: string
  alt: string
  width: number | null
  height: number | null
  kind: 'gallery' | 'before' | 'after'
  isPrimary: boolean
}

export type StoreProduct = ProductRules & {
  id: number
  name_ar: string
  name_en: string | null
  brand: string | null
  description_ar: string | null
  width_cm: number
  /**
   * العرض متثبّت من اللوحة (0013): الزبون مايكتبش عرض الشباك، والعرض
   * بيظهر مقفول على width_cm. عرض بس — التسعير والطلب مابيتأثروش.
   */
  lock_width?: boolean
  /** 0014 — السعر قبل الخصم بالقرش (عرض بس). null = مفيش خصم. */
  compare_at_piastres?: number | null
  /** 0015 — عروض رول إضافية (غير العرض الأساسي) بسعرها. فاضي/ناقص = عرض واحد. */
  width_options?: WidthOption[]
  /** 0016 — طريقة البيع. ناقص = بالمتر. */
  sale_unit?: SaleUnit
  /** 0016 — يظهر في الرئيسية والأقسام و«كل المنتجات». ناقص = ظاهر. */
  is_listed?: boolean
  /** 0016 — أقصى عدد لمنتج القطعة. */
  max_quantity?: number
  /** 0016 — الإضافات (منتجات قطعة) اللي بتظهر في صفحة المنتج ده، بالترتيب. */
  addon_ids?: number[]
  /** «الفائدة المختصرة» من اللوحة — بتظهر في كارت المنتج. ناقص/فاضي = مفيش. */
  short_benefit?: string | null
  /** «المميزات» من اللوحة — نقط في صفحة المنتج بالترتيب. ناقص/فاضي = مفيش نقط. */
  benefits?: string[]

  /** مصدر الصور المعتمد — مرتّب: الرئيسية الأول. */
  gallery: StoreImage[]

  /**
   * أعمدة قديمة — بتفضل للقراءة المزدوجة لحد ما الترحيل يكتمل.
   * ممنوع الاعتماد عليها في كود جديد؛ استخدم galleryImages/primaryImage.
   */
  image_url: string | null
  images: string[]
  before_image: string | null
  after_image: string | null
}

export type StoreSettings = {
  storeName: string
  /** اللوجو النشط من site_images. */
  logo: StoreImage | null
  /**
   * صورة الواجهة النشطة من site_images (kind = 'hero').
   * null = مفيش صورة مرفوعة، والواجهة بتبقى نص بس (من غير خانة فاضية).
   */
  heroImage: StoreImage | null
  /** عمود قديم — احتياطي لحد ما الترحيل يكتمل. */
  logoUrl: string
  offerText: string
  /** مفتاح «إظهار نص العرض» في الهوية. المفتاح مش موجود = ظاهر. */
  offerEnabled: boolean
  /** «فني التركيب» بالتواصل — من صفحة «فني التركيب» في اللوحة. */
  installation: { enabled: boolean; note: string; governorates: string[] }
  whatsappNumber: string
  whatsappMessage: string
  shippingRates: Record<string, number>
  shippingDefaultPiastres: number
  freeShippingThresholdPiastres: number
  governorates: string[]
  /** مناطق كل محافظة لاختيار سريع في صفحة الطلب (settings.shipping_areas). */
  shippingAreas: Record<string, string[]>
  /** منتجات الرئيسية + اسم رابط «كل المنتجات» (settings.home_products). */
  homeProducts: HomeProducts
  /** روابط السوشيال من «هوية المتجر» — بالترتيب الثابت، والفاضي مش موجود. */
  socialLinks: SocialLink[]
  /** 0016 — عنوان جزء الإضافات في صفحة المنتج (settings.addons_title). */
  addonsTitle: string
  announcement: Announcement
  /** محتوى الصفحة من «المحتوى» في اللوحة. */
  content: StoreContent
}

/**
 * مجموعة منتجات (0010).
 *
 * productIds مرتّبة بـ sort_order من جدول الربط. المنتجات نفسها
 * **مش** متضمّنة: الصفحة بتوصّلها من قائمة المنتجات اللي عندها أصلاً،
 * فمفيش تكرار للبيانات ولا طلب زيادة.
 */
export type StoreCollection = {
  id: number
  slug: string
  title: string
  subtitle: string
  productIds: number[]
  /** يظهر كجزء مستقل في الصفحة الرئيسية. */
  showOnHome: boolean
  /** يظهر في التنقل (الهيدر وقائمة الموبايل) وليه صفحة /collection/[slug]. */
  showInNav: boolean
  /**
   * صورة القسم: الغلاف المرفوع، وإلا أول صورة لأول منتج ظاهر فيه.
   * null بس لو مفيش ولا صورة خالص.
   */
  image: StoreImage | null
  /** true = الصورة غلاف مرفوع من اللوحة، false = بديل تلقائي من منتج. */
  hasCover: boolean
}

/** شريط الإعلان العلوي — مفتاح settings واحد (0008). */
export type Announcement = {
  enabled: boolean
  text: string
  /** داخلي يبدأ بـ/ أو https:// — وأي حاجة غير كده بتتحوّل لفاضي. */
  href: string
  ctaLabel: string
}

export type CartLine = {
  id: string
  productId: number
  lengthCm: number
  /** 0015 — العرض المختار. ناقص = العرض الأساسي للمنتج. */
  widthCm?: number
  /** 0016 — عدد القطع لمنتج القطعة (lengthCm = 0 ساعتها). */
  quantity?: number
}

export type CheckoutValues = {
  customerName: string
  customerPhone: string
  governorate: string
  address: string
  notes: string
}

export const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'جديد',
  confirmed: 'مؤكد',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
}

// ── محتوى الصفحة من «المحتوى» في اللوحة ─────────────────────────
export type HomeSectionKey = 'hero' | 'products' | 'how_it_works' | 'faq'

/** جزء من الرئيسية — بالترتيب، والمخفي visible = false. */
export type HomeSection = {
  key: HomeSectionKey
  visible: boolean
  title: string
  subtitle: string
}

export type StoreContent = {
  hero: { title: string; accent: string; subtitle: string; ctaLabel: string }
  homeSections: HomeSection[]
  orderSteps: { title: string; description: string }[]
  faqs: { question: string; answer: string }[]
  /** href فاضي = نص من غير رابط (الصفحة لسه مش موجودة). */
  footerLinks: { label: string; href: string }[]
  trustLine: string
}

/**
 * القيم الافتراضية = نفس النصوص اللي كانت ثابتة في الكود قبل ما
 * المتجر يقرا «المحتوى». بتتستخدم في وضع fallback (CI) ولو إعداد
 * ناقص أو مش مقروء — فالمتجر مايبانش فاضي أبدًا.
 */
export const DEFAULT_STORE_CONTENT: StoreContent = {
  hero: {
    title: 'أفلام حماية الزجاج،',
    accent: 'بالمتر',
    subtitle:
      'عزل حرارة، خصوصية، وتعتيم لشبابيك البيت. تدخل مقاس الشباك وإحنا نحسب الطول، والدفع عند الاستلام لكل محافظات مصر.',
    ctaLabel: 'اختار نوع الفيلم',
  },
  homeSections: [
    { key: 'hero', visible: true, title: '', subtitle: '' },
    { key: 'products', visible: true, title: 'اختار نوع الفيلم', subtitle: 'السعر بالمتر الطولي.' },
    { key: 'how_it_works', visible: true, title: '', subtitle: '' },
    { key: 'faq', visible: true, title: 'أسئلة متكررة', subtitle: '' },
  ],
  orderSteps: [
    { title: 'اختار النوع والمقاس', description: 'بمقاس الشباك أو بالمتر' },
    { title: 'أكّد الطلب', description: 'أربع خانات بس' },
    { title: 'ادفع عند الاستلام', description: 'تشوف الشحنة الأول' },
  ],
  faqs: [
    { question: 'الفيلم بيتباع إزاي؟', answer: 'بالمتر الطولي. لو الشباك أعرض من عرض الرول بنقسمه شرايح والطول بيتحسب تلقائي. إنت بس تدخل مقاس الشباك.' },
    { question: 'التركيب بيتم إزاي؟', answer: 'أدوات التركيب بتيجي مع الطلب مع شرح بالخطوات. الفيلم بيتركب بالمياه والصابون ومحتاجش فني.' },
    { question: 'الدفع إزاي؟', answer: 'الدفع عند الاستلام لكل المحافظات. تشوف الشحنة وتدفع للمندوب.' },
    { question: 'لو المقاس غلط؟', answer: 'كلّمنا على واتساب قبل ما تطلب وإحنا نحسبهولك.' },
  ],
  footerLinks: [
    { label: 'سياسة الشحن والتوصيل', href: '' },
    { label: 'الاستبدال والاسترجاع', href: '' },
    { label: 'سياسة الخصوصية', href: '' },
  ],
  trustLine: 'الدفع عند الاستلام · توصيل لكل محافظات مصر',
}

// ── فني التركيب (بالتواصل) ─────────────────────────────────────
/**
 * أول سطر في ملاحظات الطلب لما الزبون يطلب فني تركيب.
 *
 * ⚠️ حل مرحلي مقصود: العلامة في الملاحظات بدل عمود، عشان zell_create_order
 *    ماتتلمسش. الملاحظات داخلة في request_hash أصلًا، فالعلامة محمية بنفس
 *    قواعد الطلب. اللوحة وتليجرام بيتعرفوا عليها من الثابت ده بالظبط —
 *    ممنوع تغيير نصّه من غير ترحيل للطلبات القديمة.
 *    لما الحساب التلقائي يتعمل: عمود مخصص + تحويل الطلبات اللي فيها العلامة.
 */
export const INSTALLATION_NOTE_MARKER = '🔧 محتاج فني تركيب'

/** الملاحظات اللي بتتبعت مع الطلب — العلامة أول سطر لو الزبون طلب فني. */
export function composeOrderNotes(userNotes: string, wantsInstaller: boolean): string | null {
  const trimmed = userNotes.trim()
  if (!wantsInstaller) return trimmed === '' ? null : userNotes
  return trimmed === '' ? INSTALLATION_NOTE_MARKER : INSTALLATION_NOTE_MARKER + '\n' + trimmed
}

export function hasInstallerRequest(notes: string | null | undefined): boolean {
  return (notes ?? '').trim().startsWith(INSTALLATION_NOTE_MARKER)
}

// ── ترتيب المحافظات ────────────────────────────────────────────
/** لحد ما الأدمن يرتّب بنفسه: دول الأول، والباقي أبجدي. */
export const DEFAULT_GOVERNORATE_PRIORITY: readonly string[] = ['القاهرة', 'الجيزة']

/**
 * ترتيب المحافظات حسب اللوحة (settings.shipping_order).
 * محافظة مش في الترتيب المحفوظ (اتضافت بعده) بتيجي في الآخر أبجدي —
 * فمفيش محافظة بتختفي من القايمة لو الترتيب قديم.
 */
export function orderGovernorates(names: readonly string[], saved: readonly string[]): string[] {
  const available = new Set(names)
  const source = saved.length > 0 ? saved : DEFAULT_GOVERNORATE_PRIORITY
  const out: string[] = []
  for (const name of source) if (available.has(name) && !out.includes(name)) out.push(name)
  const rest = names.filter((name) => !out.includes(name)).sort((a, b) => a.localeCompare(b, 'ar'))
  return [...out, ...rest]
}

// ── الرئيسية: المنتجات المعروضة ─────────────────────────────────
export type HomeProductsMode = 'all' | 'selected' | 'none'

/**
 * settings.home_products — من «الصفحة الرئيسية» في صفحة الأقسام باللوحة.
 *   mode      all = كل المنتجات · selected = اللي في ids بس · none = الأقسام بس
 *   ids       بالترتيب اللي اتعلّم بيه
 *   allLabel  اسم رابط «كل المنتجات» في القائمة — فاضي = الرابط مخفي
 */
export type HomeProducts = { mode: HomeProductsMode; ids: number[]; allLabel: string }

export const DEFAULT_HOME_PRODUCTS: HomeProducts = { mode: 'all', ids: [], allLabel: 'كل الأفلام' }

export function parseHomeProducts(value: unknown): HomeProducts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...DEFAULT_HOME_PRODUCTS, ids: [] }
  const raw = value as Record<string, unknown>
  const rawMode = raw['mode']
  const mode: HomeProductsMode = rawMode === 'selected' || rawMode === 'none' ? rawMode : 'all'
  const ids: number[] = []
  const rawIds: unknown = raw['ids']
  if (Array.isArray(rawIds)) {
    for (const id of rawIds as unknown[]) {
      if (typeof id === 'number' && Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id)
    }
  }
  const label = raw['allLabel']
  return { mode, ids, allLabel: typeof label === 'string' ? label.trim() : DEFAULT_HOME_PRODUCTS.allLabel }
}

/** المنتجات اللي تظهر في جزء «المنتجات» في الرئيسية. */
export function pickHomeProducts<T extends { id: number }>(products: readonly T[], home: HomeProducts): T[] {
  if (home.mode === 'none') return []
  if (home.mode === 'all') return [...products]
  const byId = new Map(products.map((product) => [product.id, product]))
  return home.ids.map((id) => byId.get(id)).filter((product): product is T => product !== undefined)
}

// ── مناطق المحافظات ────────────────────────────────────────────
/** settings.shipping_areas — { "الجيزة": ["أكتوبر", "الشيخ زايد"] }. عرض بس، السعر بالمحافظة. */
export function parseShippingAreas(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string[]> = {}
  for (const [name, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const areas: string[] = []
    for (const item of list as unknown[]) {
      if (typeof item !== 'string') continue
      const area = item.trim()
      if (area !== '' && !areas.includes(area)) areas.push(area)
    }
    if (areas.length > 0) out[name] = areas
  }
  return out
}

/** المنطقة المختارة بتتكتب أول العنوان — من غير أي تغيير في جدول الطلبات. */
export function composeAddress(area: string, address: string): string {
  const name = area.trim()
  return name === '' ? address : name + ' — ' + address.trim()
}

// ── السوشيال ميديا ─────────────────────────────────────────────
export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube', 'snapchat', 'x'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  facebook: 'فيسبوك',
  instagram: 'إنستجرام',
  tiktok: 'تيك توك',
  youtube: 'يوتيوب',
  snapchat: 'سناب شات',
  x: 'إكس (تويتر)',
}

export type SocialLink = { platform: SocialPlatform; url: string }

const SOCIAL_URL_SHAPE = /^https:\/\/[^\s/?#"'<>]+\.[^\s/?#"'<>]+([/?#][^\s"'<>]*)?$/i
const MAX_SOCIAL_URL = 300

/**
 * «facebook.com/zell» أو «https://…» -> رابط https كامل، أو null لو مش رابط.
 * http بيتحوّل https، وأي بروتوكول تاني (javascript: وغيره) مرفوض.
 */
export function normalizeSocialUrl(input: string): string | null {
  const raw = input.trim()
  if (raw === '' || raw.length > MAX_SOCIAL_URL) return null
  const lower = raw.toLowerCase()
  const url = lower.startsWith('https://')
    ? raw
    : lower.startsWith('http://')
      ? 'https://' + raw.slice(7)
      : raw.includes('://')
        ? ''
        : 'https://' + raw.replace(/^\/+/, '')
  return SOCIAL_URL_SHAPE.test(url) ? url : null
}

/** settings.social_links — { facebook: "https://…" } -> قايمة بالترتيب الثابت. */
export function parseSocialLinks(value: unknown): SocialLink[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const raw = value as Record<string, unknown>
  const out: SocialLink[] = []
  for (const platform of SOCIAL_PLATFORMS) {
    const item = raw[platform]
    if (typeof item !== 'string') continue
    const url = normalizeSocialUrl(item)
    if (url !== null) out.push({ platform, url })
  }
  return out
}

// ── الخصم (عرض بس) ─────────────────────────────────────────────
/**
 * الزبون بيدفع price_per_meter_piastres دايمًا — compare_at_piastres للعرض بس
 * (السعر القديم مشطوب + النسبة). فـ zell_create_order مالهاش دعوة بالخصم.
 */
export type DiscountInfo = { percent: number; savePiastres: number; compareAtPiastres: number }

export function discountInfo(product: {
  price_per_meter_piastres: number
  compare_at_piastres?: number | null
}): DiscountInfo | null {
  const compare = product.compare_at_piastres
  const price = product.price_per_meter_piastres
  if (typeof compare !== 'number' || price <= 0 || compare <= price) return null
  const percent = Math.round((1 - price / compare) * 100)
  if (percent < 1) return null
  return { percent, savePiastres: compare - price, compareAtPiastres: compare }
}

// ── عروض الرول ─────────────────────────────────────────────────
/**
 * 0015 — المنتج ليه عرض أساسي (products.width_cm بسعره) + عروض إضافية من
 * product_widths، كل واحد بسعر المتر بتاعه. zell_create_order بتسعّر من
 * الداتابيز حسب العرض المختار — المتصفح مابيبعتش أسعار.
 */
export type WidthOption = {
  width_cm: number
  price_per_meter_piastres: number
  compare_at_piastres: number | null
}

/** كل العروض المتاحة بالترتيب: الأساسي الأول، وبعده الإضافية. */
export function widthOptionsOf(product: StoreProduct): WidthOption[] {
  const base: WidthOption = {
    width_cm: product.width_cm,
    price_per_meter_piastres: product.price_per_meter_piastres,
    compare_at_piastres: product.compare_at_piastres ?? null,
  }
  const extras = (product.width_options ?? []).filter((option) => option.width_cm !== product.width_cm)
  return [base, ...extras]
}

/**
 * المنتج بالعرض المختار (العرض والسعر والخصم بتوعه). العرض الناقص أو
 * الأساسي = المنتج زي ما هو. عرض مش متاح = null.
 */
export function withWidth(product: StoreProduct, widthCm: number | undefined): StoreProduct | null {
  if (widthCm === undefined || widthCm === product.width_cm) return product
  const option = (product.width_options ?? []).find((item) => item.width_cm === widthCm)
  if (!option) return null
  return {
    ...product,
    width_cm: option.width_cm,
    price_per_meter_piastres: option.price_per_meter_piastres,
    compare_at_piastres: option.compare_at_piastres,
  }
}

/** أقل سعر متر بين العروض — لـ«يبدأ من». */
export function lowestPricePerMeter(product: StoreProduct): number {
  return Math.min(...widthOptionsOf(product).map((option) => option.price_per_meter_piastres))
}

// ── البيع بالقطعة (0016) ──────────────────────────────────────
/**
 * المنتج يا بالمتر (أفلام — طول وعرض رول) يا بالقطعة (إضافات وأدوات — عدد).
 * القطعة: السعر في price_per_meter_piastres = سعر القطعة، والحساب السعر × العدد —
 * نفس فرع القطعة في zell_create_order بالحرف.
 */
export type SaleUnit = 'meter' | 'piece'

export const DEFAULT_ADDONS_TITLE = 'أدوات التركيب'
export const MAX_PIECE_QUANTITY = 999

export function isPiece(product: { sale_unit?: SaleUnit }): boolean {
  return product.sale_unit === 'piece'
}

export function isListed(product: { is_listed?: boolean }): boolean {
  return product.is_listed !== false
}

export function maxQuantityOf(product: { max_quantity?: number }): number {
  const max = product.max_quantity
  return typeof max === 'number' && Number.isInteger(max) && max >= 1 ? Math.min(max, MAX_PIECE_QUANTITY) : 20
}

/**
 * المنتج اللي سطر السلة بيتحسب عليه — أو null لو السطر مابقاش صالح
 * (نوع البيع اتغيّر، العرض اتشال، العدد فوق الأقصى).
 */
export function resolveCartLine(
  product: StoreProduct,
  line: { widthCm?: number; quantity?: number },
): StoreProduct | null {
  if (isPiece(product)) {
    const quantity = line.quantity
    return quantity !== undefined && quantity >= 1 && quantity <= maxQuantityOf(product) ? product : null
  }
  if (line.quantity !== undefined) return null
  return withWidth(product, line.widthCm)
}
