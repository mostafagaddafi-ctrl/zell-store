/**
 * ⚠️ مصدر بيانات مؤقت — مرحلة ١ فقط.
 *
 * الأرقام والنصوص دي منسوخة حرفياً من صفوف Production الحقيقية
 * (جدولي products و settings) عشان الواجهة تتبني على قيم صح مش مخترعة.
 * مفيش أي اتصال بالداتابيز في المرحلة دي وده مقصود: ممنوع أسرار في الريبو.
 *
 * مرحلة ٢ هتستبدل الملف ده بقراءة server-side من Supabase،
 * والواجهة ما تتغيّرش لأنها بتستهلك نفس الأنواع من @zell/core.
 */
import type { StoreProduct, StoreSettings } from '@zell/core'

export const TEMP_PRODUCTS: StoreProduct[] = [
  {
    id: 1,
    name_ar: 'عازل حرارة',
    name_en: 'Heat Rejection Window Film',
    brand: null,
    description_ar:
      'الصالة أو الأوضة اللي الشمس بتضربها طول النهار: بيقلل الحرارة والوهج، والتكييف يتعب أقل، والفرش ما يبهتش. الرؤية من جوه تفضل واضحة.',
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

const SHIPPING_RATES: Record<string, number> = {
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

export const TEMP_SETTINGS: StoreSettings = {
  storeName: 'ZELL',
  logoUrl: '',
  offerText: 'أدوات التركيب مرفقة مجاناً',
  whatsappNumber: '201000000000',
  whatsappMessage: 'مرحباً ZELL، عايز أستفسر عن فيلم زجاج للبيت',
  shippingRates: SHIPPING_RATES,
  shippingDefaultPiastres: 8000,
  freeShippingThresholdPiastres: 0,
  governorates: Object.keys(SHIPPING_RATES),
}

export function getProducts(): StoreProduct[] {
  return TEMP_PRODUCTS
}

export function getProductById(id: number): StoreProduct | undefined {
  return TEMP_PRODUCTS.find((product) => product.id === id)
}

export function getSettings(): StoreSettings {
  return TEMP_SETTINGS
}
