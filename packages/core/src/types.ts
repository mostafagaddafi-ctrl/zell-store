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
