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
  /** عمود قديم — احتياطي لحد ما الترحيل يكتمل. */
  logoUrl: string
  offerText: string
  whatsappNumber: string
  whatsappMessage: string
  shippingRates: Record<string, number>
  shippingDefaultPiastres: number
  freeShippingThresholdPiastres: number
  governorates: string[]
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
