/**
 * أنواع اللوحة + مصدر البيانات.
 *
 * ⚠️ الملف ده بيستورد طبقة قراءة **server-only**، فممنوع أي Client
 * Component يستورد منه قيمة فعلية. الأنواع بس (import type) — دي بتتمسح
 * وقت الترجمة فمابتجرّش حاجة للمتصفح.
 * الثوابت المشتركة مكانها lib/enums.ts.
 */
import { supabaseAdminData } from './data/reads'
import type { ImageFit, OrderStatus, SectionKey } from './enums'

export * from './enums'

// ── الطلبات ──────────────────────────────────────────────────
export type AdminOrder = {
  id: number
  orderNumber: string
  status: OrderStatus
  customerName: string
  customerPhone: string
  governorate: string
  itemCount: number
  totalPiastres: number
  notifiedAt: string | null
  notifyError: string | null
  createdAt: string
}

export type AdminOrderItem = {
  productNameAr: string
  lengthCm: number
  widthCm: number
  unitPricePiastres: number
  lineTotalPiastres: number
}

export type AdminOrderDetail = AdminOrder & {
  address: string
  notes: string | null
  /** مفيش عمود internal_notes في الداتابيز لسه — بيرجع null */
  internalNotes: string | null
  subtotalPiastres: number
  shippingPiastres: number
  items: AdminOrderItem[]
}

export type OrdersQuery = {
  status?: OrderStatus | 'all'
  search?: string
  page: number
  pageSize: number
}

/** عدّ دقيق — قرار معتمد. يتعاد تقييمه لما البيانات تكبر. */
export type OrdersPage = {
  rows: AdminOrder[]
  total: number
  page: number
  pageSize: number
}

export type OrdersSummary = {
  newCount: number
  todayCount: number
  totalOrders: number
  salesPiastres: number
  salesMonthPiastres: number
}

// ── المنتجات والصور ──────────────────────────────────────────
export type AdminImage = {
  id: number
  url: string
  alt: string
  fit: ImageFit
  sortOrder: number
  isPrimary: boolean
  width: number | null
  height: number | null
  updatedAt: string
}

export type AdminProduct = {
  id: number
  nameAr: string
  nameEn: string
  brand: string
  descriptionAr: string
  shortBenefit: string
  benefits: string[]
  pricePerMeterPiastres: number
  widthCm: number
  minLengthCm: number
  stepCm: number
  maxLengthCm: number
  isActive: boolean
  sortOrder: number
  imageCount: number
  updatedAt: string
}

export type AdminProductDetail = AdminProduct & { images: AdminImage[] }

// ── محتوى المتجر ─────────────────────────────────────────────
export type HeroContent = { title: string; accent: string; subtitle: string; ctaLabel: string }
export type OrderStep = { title: string; description: string }
export type FaqItem = { question: string; answer: string }

export type StoreSection = {
  key: SectionKey
  visible: boolean
  sortOrder: number
  title?: string
  subtitle?: string
}

export type FooterLink = { label: string; href: string }

export type StoreContent = {
  hero: HeroContent
  orderSteps: OrderStep[]
  faqs: FaqItem[]
  sections: StoreSection[]
  footerLinks: FooterLink[]
  trustLine: string
}

// ── الشحن والهوية والتشغيل ───────────────────────────────────
export type ShippingSettings = {
  rates: Record<string, number>
  defaultPiastres: number
  freeThresholdPiastres: number
  /** مفيش مفتاح للمحافظات الموقوفة لسه — بيرجع فاضي */
  disabled: string[]
}

export type StoreIdentity = {
  storeName: string
  logo: AdminImage | null
  offerText: string
  whatsappNumber: string
  whatsappMessage: string
}

export type ReadinessCheck = { key: string; label: string; ok: boolean; detail: string }

export type OperationalSettings = {
  notifyEmail: string
  /** التوكن نفسه ما بيخرجش من السيرفر أبدًا — حالة بس */
  telegramConfigured: boolean
  readiness: ReadinessCheck[]
}

// ── واجهة القراءة ────────────────────────────────────────────
export interface AdminDataSource {
  listOrders(query: OrdersQuery): Promise<OrdersPage>
  getOrder(orderNumber: string): Promise<AdminOrderDetail | null>
  getOrdersSummary(): Promise<OrdersSummary>
  /** بترجّع النشط وغير النشط — مفيش بارامتر includeInactive */
  listProducts(): Promise<AdminProduct[]>
  getProduct(id: number): Promise<AdminProductDetail | null>
  getContent(): Promise<StoreContent>
  getShipping(): Promise<ShippingSettings>
  getIdentity(): Promise<StoreIdentity>
  getOperationalSettings(): Promise<OperationalSettings>
}

/** قراءة حقيقية من Production. التعديلات في lib/actions.ts وكلها موقوفة. */
export const adminData: AdminDataSource = supabaseAdminData
