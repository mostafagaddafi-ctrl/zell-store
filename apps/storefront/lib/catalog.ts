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
import { DEFAULT_STORE_CONTENT } from '@zell/core'

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
  installation: { enabled: false, note: '', governorates: [] },
  whatsappNumber: '201000000000',
  whatsappMessage: 'مرحباً ZELL، عايز أستفسر عن فيلم زجاج للبيت',
  shippingRates: FALLBACK_SHIPPING_RATES,
  shippingDefaultPiastres: 8000,
  freeShippingThresholdPiastres: 0,
  governorates: Object.keys(FALLBACK_SHIPPING_RATES),
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

export function getFallbackCollections(): StoreCollection[] {
  return FALLBACK_COLLECTIONS
}

/** الأسماء مكتوبة بـ Fallback عن قصد — عشان مكان الاستدعاء يفضح إنها مؤقتة. */
export function getFallbackProducts(): StoreProduct[] {
  return FALLBACK_PRODUCTS
}

export function getFallbackProductById(id: number): StoreProduct | undefined {
  return FALLBACK_PRODUCTS.find((product) => product.id === id)
}

export function getFallbackSettings(): StoreSettings {
  return FALLBACK_SETTINGS
}
