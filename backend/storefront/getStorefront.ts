/**
 * بيانات صفحة العميل: المنتجات النشطة + الإعدادات العامة (شحن، واتساب، عروض).
 * استدعاء واحد بدل عدة استدعاءات.
 */
import { loadSettings, settingNumber, settingRecord, settingString, sql } from '../lib/db'

export type Testimonial = { name: string; area: string; text: string }
export type GalleryItem = { before: string; after: string; caption: string }
export type MaterialPhoto = { image: string; caption: string }

export type StorefrontProduct = {
  id: number
  name_ar: string
  name_en: string | null
  brand: string | null
  description_ar: string | null
  image_url: string | null
  images: string[]
  before_image: string | null
  after_image: string | null
  price_per_meter_piastres: number
  width_cm: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
}

export type StorefrontData = {
  products: StorefrontProduct[]
  storeName: string
  logoUrl: string
  offerText: string
  whatsappNumber: string
  whatsappMessage: string
  shippingRates: Record<string, number>
  shippingDefaultPiastres: number
  freeShippingThresholdPiastres: number
  governorates: string[]
  testimonials: Testimonial[]
  gallery: GalleryItem[]
  materials: MaterialPhoto[]
}

export default async function (): Promise<StorefrontData> {
  const [products, settings] = await Promise.all([
    sql<StorefrontProduct>(
      `select id, name_ar, name_en, brand, description_ar, image_url,
              coalesce(images, '[]'::jsonb) as images, before_image, after_image,
              price_per_meter_piastres,
              width_cm, min_length_cm, step_cm, max_length_cm
       from products
       where is_active = true
       order by sort_order, id`,
    ),
    loadSettings(),
  ])

  const shippingRates = settingRecord(settings, 'shipping_rates')

  return {
    products,
    storeName: settingString(settings, 'store_name', 'متجر أفلام الحماية'),
    logoUrl: settingString(settings, 'logo_url'),
    offerText: settingString(settings, 'offer_text'),
    whatsappNumber: settingString(settings, 'whatsapp_number'),
    whatsappMessage: settingString(settings, 'whatsapp_message'),
    shippingRates,
    shippingDefaultPiastres: settingNumber(settings, 'shipping_default_piastres', 0),
    freeShippingThresholdPiastres: settingNumber(settings, 'free_shipping_threshold_piastres', 0),
    governorates: Object.keys(shippingRates).sort((a, b) => a.localeCompare(b, 'ar')),
    testimonials: asTestimonials(settings['testimonials']),
    gallery: asGallery(settings['gallery']),
    materials: asMaterials(settings['materials']),
  }
}

function asMaterials(value: unknown): MaterialPhoto[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>
      return {
        image: typeof row['image'] === 'string' ? row['image'] : '',
        caption: typeof row['caption'] === 'string' ? row['caption'] : '',
      }
    })
    .filter((row) => row.image !== '')
}

function asTestimonials(value: unknown): Testimonial[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>
      return {
        name: typeof row['name'] === 'string' ? row['name'] : '',
        area: typeof row['area'] === 'string' ? row['area'] : '',
        text: typeof row['text'] === 'string' ? row['text'] : '',
      }
    })
    .filter((row) => row.name !== '' && row.text !== '')
}

function asGallery(value: unknown): GalleryItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>
      return {
        before: typeof row['before'] === 'string' ? row['before'] : '',
        after: typeof row['after'] === 'string' ? row['after'] : '',
        caption: typeof row['caption'] === 'string' ? row['caption'] : '',
      }
    })
    .filter((row) => row.after !== '')
}
