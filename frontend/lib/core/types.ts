/** أنواع مشتركة بين مكوّنات الواجهة — مطابقة لمخرجات دوال الباك إند. */

export type StoreProduct = {
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

export type Testimonial = { name: string; area: string; text: string }
export type GalleryItem = { before: string; after: string; caption: string }
export type MaterialPhoto = { image: string; caption: string }

export type StorefrontData = {
  products: StoreProduct[]
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

export type OrderItem = {
  product_name_ar: string
  product_image_url: string | null
  unit_price_piastres: number
  length_cm: number
  width_cm: number
  line_total_piastres: number
}

export type CreatedOrder = {
  id: number
  order_number: string
  status: string
  subtotal_piastres: number
  shipping_piastres: number
  total_piastres: number
  customer_name: string
  customer_phone: string
  governorate: string
  address: string
  created_at: string
  items: OrderItem[]
}

export type CreateOrderResult =
  | { ok: true; order: CreatedOrder; notified: boolean }
  | { ok: false; message: string }

export type AdminOrder = CreatedOrder & {
  notes: string | null
  notified_at: string | null
  notify_error: string | null
}

export type OrdersSummary = {
  new_count: number
  total_orders: number
  today_count: number
  sales_piastres: number
  sales_month_piastres: number
}

export type AdminProduct = StoreProduct & {
  is_active: boolean
  sort_order: number
  created_at: string
}

export type AdminSettings = {
  store_name: string
  logo_url: string
  offer_text: string
  whatsapp_number: string
  whatsapp_message: string
  notify_email: string
  telegram_bot_token: string
  telegram_chat_id: string
  shipping_default_piastres: number
  free_shipping_threshold_piastres: number
  shipping_rates: Record<string, number>
  testimonials: Testimonial[]
  gallery: GalleryItem[]
  materials: MaterialPhoto[]
}

export type SettingsSavePayload = {
  store_name: string
  logo_url: string
  offer_text: string
  whatsapp_number: string
  whatsapp_message: string
  notify_email: string
  shipping_default_piastres: number
  free_shipping_threshold_piastres: number
  shipping_rates: Record<string, number>
  testimonials: Testimonial[]
  gallery: GalleryItem[]
  materials: MaterialPhoto[]
}

export type ReadinessCheck = {
  key: string
  label: string
  ok: boolean
  detail: string
}

export const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const STATUS_LABELS: Record<string, string> = {
  new: 'جديد',
  confirmed: 'مؤكد',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
}
