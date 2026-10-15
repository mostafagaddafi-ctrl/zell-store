/**
 * ⚠️⚠️ FALLBACK مؤقت — **مش مصدر بيانات**. ⚠️⚠️
 *
 * نسخة مجمّدة باليد من صفوف Production وقت كتابة المرحلة الأولى، عشان
 * الواجهة تتبني وتتراجع بأرقام حقيقية من غير أي مفتاح Supabase في الريبو.
 *
 *   • الأرقام بتقدم كل ما حد يعدّل منتج أو سعر من الداشبورد.
 *   • ممنوع أي منطق أعمال يعتمد على الملف ده.
 *   • مصيره الحذف، مش التوسعة.
 *
 * 🚫 **مفيش أي مسار صور من Production هنا.** المعارض فاضية عن قصد —
 * الروابط الحقيقية بتتبنى في طبقة القراءة المعتمدة على السيرفر.
 */
import type { StoreProduct, StoreCollection, StoreSettings } from '@zell/core'
import { DEFAULT_INSTALLATION_TOOLS_PAGE, DEFAULT_STORE_CONTENT } from '@zell/core'

export const FALLBACK_PRODUCTS: StoreProduct[] = [
  {
    id: 1,
    name_ar: 'عازل حرارة',
    name_en: 'Heat Rejection Window Film',
    brand: null,
    description_ar:
      'الصالة أو الأوضة اللي الشمس بتضربها طول النهار: بيقلل الحرارة والوهج، والتكييف يتعب أقل، والفرش ما يبهتش. الرؤية من جوه تفضل واضحة.',
    gallery: [],
    image_url: null,
    images: [],
    before_image: null,
    after_image: null,
    price_per_meter_piastres: 18000,
    width_cm: 50,
    min_length_cm: 300,
    step_cm: 50,
    max_length_cm: 3000,
  },
  {
    id: 2,
    name_ar: 'مصنفر (خصوصية)',
    name_en: 'Frosted Privacy Film',
    brand: null,
    description_ar:
      'زجاج مطفي زي السنفرة — محدش يشوف من بره والنور بيدخل عادي. الأنسب للحمام والمطبخ والأبواب الزجاجية الداخلية.',
    gallery: [],
    image_url: null,
    images: [],
    before_image: null,
    after_image: null,
    price_per_meter_piastres: 12000,
    width_cm: 50,
    min_length_cm: 300,
    step_cm: 50,
    max_length_cm: 3000,
  },
  {
    id: 3,
    name_ar: 'فاميه أسود',
    name_en: 'Black Smoked Film',
    brand: null,
    description_ar:
      'تعتيم قوي وخصوصية كاملة من بره، وبيقلل الشمس والوهج كمان. مناسب للبلكونة والشبابيك المطلة على الشارع.',
    gallery: [],
    image_url: null,
    images: [],
    before_image: null,
    after_image: null,
    price_per_meter_piastres: 20000,
    width_cm: 50,
    min_length_cm: 300,
    step_cm: 50,
    max_length_cm: 3000,
  },
]

/** المنتج رقم ٤ (أمان/سيكيورتي) غير نشط في Production فمش معروض هنا — قرار معتمد. */

const FALLBACK_SHIPPING_RATES: Record<string, number> = {
  القاهرة: 5000,
  الجيزة: 5000,
  القليوبية: 6000,
  الشرقية: 7000,
  الغربية: 7000,
  الدقهلية: 7000,
  المنوفية: 7000,
  الإسكندرية: 7000,
  البحيرة: 8000,
  'كفر الشيخ': 8000,
  دمياط: 8000,
  بورسعيد: 8000,
  الإسماعيلية: 8000,
  السويس: 8000,
  الفيوم: 8000,
  'بني سويف': 8000,
  المنيا: 9000,
  أسيوط: 9000,
  سوهاج: 9000,
  قنا: 10000,
  الأقصر: 10000,
  أسوان: 11000,
  مطروح: 12000,
  'البحر الأحمر': 12000,
  'الوادي الجديد': 13000,
  'شمال سيناء': 13000,
  'جنوب سيناء': 13000,
}

export const FALLBACK_SETTINGS: StoreSettings = {
  storeName: 'ZELL',
  logo: null,
  heroImage: null,
  logoUrl: '',
  offerText: 'أدوات التركيب مرفقة مجاناً',
  offerEnabled: true,
  installation: { enabled: false, note: '', feePerMeterPiastres: null, areas: {} },
  whatsappNumber: '201000000000',
  whatsappMessage: 'مرحباً ZELL، عايز أستفسر عن فيلم زجاج للبيت',
  shippingRates: FALLBACK_SHIPPING_RATES,
  shippingDefaultPiastres: 8000,
  freeShippingThresholdPiastres: 0,
  governorates: Object.keys(FALLBACK_SHIPPING_RATES),
  shippingAreas: {},
  homeProducts: { mode: 'all', ids: [], allLabel: 'كل الأفلام' },
  socialLinks: [],
  addonsTitle: 'أدوات التركيب',
  installationToolsPage: DEFAULT_INSTALLATION_TOOLS_PAGE,
  // الكتالوج المؤقت مافيهوش أكواد خصم
  couponsEnabled: false,
  // الكتالوج المؤقت مابيعرضش شريط — الشريط بيانات حقيقية من settings بس
  announcement: { enabled: false, text: '', href: '', ctaLabel: '' },
  content: DEFAULT_STORE_CONTENT,
}

/**
 * الكتالوج المؤقت **مالوش مجموعات**.
 *
 * المجموعات بيانات حقيقية بيدخّلها الأدمن، ومفيش معنى لاختراع
 * مجموعات وهمية — الرئيسية ببساطة مابتعرضش قسم مجموعات في وضع
 * fallback. ده هو الوضع اللي CI بيبني بيه، فالبناء بيغطي الحالة
 * الفاضية فعليًا.
 */
export const FALLBACK_COLLECTIONS: StoreCollection[] = []

// ════════════════════════════════════════════════════════════════════
// ⚠️ PREVIEW FIXTURES — مؤقت لمعاينة STORE-MENU (#159) في Codespaces بس.
//    فرع chore/store-menu-preview-fixtures فوق head الـ PR (c669df3). **مش للدمج ولا للنشر.**
//    من غير أي مفتاح أو اتصال: كله بيانات مكتوبة هنا، والروابط example.com، واللوجو ملف اختبار محلي.
//
//    ZELL_PREVIEW_SCENARIO : غايب = الأقسام والإعدادات زي الكتالوج بالحرف · long · four · empty
//    ZELL_PREVIEW_LOGO=1   : لوجو مرفوع = /preview-logo.png (320×80، صورة اختبار في public)
//    ZELL_PREVIEW_TOOLS=1  : منتج أدوات (قطعة، مخفي من القوايم) مربوط بالفيلم 1 + صفحة الأدوات مفعّلة
//    المتغيرات بتتقري وقت البناء (الصفحات static)، فأي تغيير = build جديد.
// ════════════════════════════════════════════════════════════════════
type PreviewScenario = 'none' | 'long' | 'four' | 'empty'

function previewScenario(): PreviewScenario {
  const raw = (process.env['ZELL_PREVIEW_SCENARIO'] ?? '').trim()
  return raw === 'long' || raw === 'four' || raw === 'empty' ? raw : 'none'
}

function previewFlag(name: 'ZELL_PREVIEW_LOGO' | 'ZELL_PREVIEW_TOOLS'): boolean {
  return (process.env[name] ?? '').trim() === '1'
}

function previewCollection(id: number, slug: string, title: string, showInNav = true): StoreCollection {
  return { id, slug, title, subtitle: '', productIds: [1, 2, 3], showOnHome: false, showInNav, image: null, hasCover: false, catalogLayout: 'cards' }
}

/** 5 أقسام في القائمة بأسامي طويلة (overflow في هيدر الكمبيوتر) + slug عربي + قسم مخفي من القائمة. */
const PREVIEW_LONG_COLLECTIONS: StoreCollection[] = [
  previewCollection(101, 'heat-nano-ceramic', 'عازل حرارة نانو سيراميك للشبابيك'),
  previewCollection(102, 'خصوصية-ومصنفر', 'أفلام خصوصية ومصنفر للحمامات والمطابخ'),
  previewCollection(103, 'blackout', 'فاميه وتعتيم كامل للبلكونات'),
  previewCollection(104, 'safety', 'أفلام أمان ضد الكسر للأبواب الزجاجية'),
  previewCollection(105, 'decor', 'أفلام ديكور ورخام للزجاج الداخلي'),
  previewCollection(106, 'hidden-from-nav', 'قسم مخفي من القائمة', false),
]

const PREVIEW_SOCIAL: StoreSettings['socialLinks'] = [
  { platform: 'facebook', url: 'https://example.com/facebook' },
  { platform: 'instagram', url: 'https://example.com/instagram' },
  { platform: 'tiktok', url: 'https://example.com/tiktok' },
  { platform: 'youtube', url: 'https://example.com/youtube' },
  { platform: 'snapchat', url: 'https://example.com/snapchat' },
  { platform: 'x', url: 'https://example.com/x' },
]

const PREVIEW_LOGO: StoreSettings['logo'] = {
  id: 900,
  url: '/preview-logo.png',
  alt: 'شعار اختبار',
  width: 320,
  height: 80,
  kind: 'gallery',
  isPrimary: true,
}

/** أداة تركيب (قطعة، مخفية من القوايم) — بيانات اختبار بس. */
const PREVIEW_TOOL: StoreProduct = {
  id: 90,
  name_ar: 'طقم أدوات التركيب (اختبار)',
  name_en: null,
  brand: null,
  description_ar: 'بيانات اختبار للمعاينة.',
  gallery: [],
  image_url: null,
  images: [],
  before_image: null,
  after_image: null,
  price_per_meter_piastres: 15000,
  width_cm: 50,
  min_length_cm: 300,
  step_cm: 50,
  max_length_cm: 3000,
  sale_unit: 'piece',
  is_listed: false,
  max_quantity: 5,
}

function previewProducts(): StoreProduct[] {
  if (!previewFlag('ZELL_PREVIEW_TOOLS')) return FALLBACK_PRODUCTS
  return [...FALLBACK_PRODUCTS.map((product) => (product.id === 1 ? { ...product, addon_ids: [PREVIEW_TOOL.id] } : product)), PREVIEW_TOOL]
}

function previewCollections(): StoreCollection[] {
  const scenario = previewScenario()
  if (scenario === 'long') return PREVIEW_LONG_COLLECTIONS
  if (scenario === 'four') return PREVIEW_LONG_COLLECTIONS.slice(0, 4)
  return FALLBACK_COLLECTIONS
}

function previewScenarioSettings(): StoreSettings {
  const scenario = previewScenario()
  if (scenario === 'long' || scenario === 'four') {
    return {
      ...FALLBACK_SETTINGS,
      socialLinks: PREVIEW_SOCIAL,
      homeProducts: { ...FALLBACK_SETTINGS.homeProducts, allLabel: scenario === 'long' ? 'كل الأفلام والمنتجات المتاحة' : FALLBACK_SETTINGS.homeProducts.allLabel },
    }
  }
  if (scenario === 'empty') {
    return {
      ...FALLBACK_SETTINGS,
      whatsappNumber: '',
      socialLinks: [],
      homeProducts: { ...FALLBACK_SETTINGS.homeProducts, allLabel: '' },
      content: {
        ...DEFAULT_STORE_CONTENT,
        homeSections: DEFAULT_STORE_CONTENT.homeSections.map((section) =>
          section.key === 'how_it_works' || section.key === 'faq' ? { ...section, visible: false } : section,
        ),
      },
    }
  }
  return FALLBACK_SETTINGS
}

function previewSettings(): StoreSettings {
  const base = previewScenarioSettings()
  const withLogo = previewFlag('ZELL_PREVIEW_LOGO') ? { ...base, logo: PREVIEW_LOGO } : base
  return previewFlag('ZELL_PREVIEW_TOOLS')
    ? { ...withLogo, installationToolsPage: { ...withLogo.installationToolsPage, enabled: true } }
    : withLogo
}

export function getFallbackCollections(): StoreCollection[] {
  return previewCollections()
}

/** الأسماء مكتوبة بـ Fallback عن قصد — عشان مكان الاستدعاء يفضح إنها مؤقتة. */
export function getFallbackProducts(): StoreProduct[] {
  return previewProducts()
}

export function getFallbackProductById(id: number): StoreProduct | undefined {
  return previewProducts().find((product) => product.id === id)
}

export function getFallbackSettings(): StoreSettings {
  return previewSettings()
}
