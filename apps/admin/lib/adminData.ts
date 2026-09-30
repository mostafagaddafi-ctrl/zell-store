/**
 * عقد بيانات اللوحة — **نقطة الاتصال الوحيدة**.
 *
 * المرحلة أ بتنفّذ القراءة ببيانات ثابتة (fallback). لما الباك إند يجهز،
 * بنبدّل التنفيذ هنا بس والصفحات ما تتغيّرش.
 *
 * 🔒 المرحلة أ: **مفيش أي كتابة**. توقيعات التعديل معرّفة في AdminMutations
 * عشان الباك إند يعرف المطلوب، ومفيش لها تنفيذ — كل أزرار الحفظ معطّلة.
 */
import { fallbackAdminData } from './fallback/data'

// ── حالة الحفظ ────────────────────────────────────────────────
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

// ── الطلبات ──────────────────────────────────────────────────
export const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'جديد',
  confirmed: 'مؤكد',
  shipped: 'اتشحن',
  delivered: 'اتسلّم',
  cancelled: 'ملغي',
}

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
export type ImageFit = 'cover' | 'contain'

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

export const SECTION_KEYS = ['hero', 'products', 'how_it_works', 'faq'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_LABELS: Record<SectionKey, string> = {
  hero: 'الواجهة الرئيسية',
  products: 'المنتجات',
  how_it_works: 'خطوات الطلب',
  faq: 'الأسئلة الشائعة',
}

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
  /** محافظات متوقفة مؤقتًا من غير حذف سعرها */
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
  /** 🔒 التوكن نفسه ما بيخرجش من السيرفر أبدًا — حالة بس */
  telegramConfigured: boolean
  readiness: ReadinessCheck[]
}

// ── واجهة القراءة ────────────────────────────────────────────
export interface AdminDataSource {
  listOrders(query: OrdersQuery): Promise<OrdersPage>
  getOrder(orderNumber: string): Promise<AdminOrderDetail | null>
  getOrdersSummary(): Promise<OrdersSummary>
  listProducts(): Promise<AdminProduct[]>
  getProduct(id: number): Promise<AdminProductDetail | null>
  getContent(): Promise<StoreContent>
  getShipping(): Promise<ShippingSettings>
  getIdentity(): Promise<StoreIdentity>
  getOperationalSettings(): Promise<OperationalSettings>
}

/**
 * ── واجهة الكتابة — **مش منفّذة في المرحلة أ** ──
 *
 * معرّفة هنا عشان الباك إند يعرف المطلوب بالظبط.
 * كل حفظ بيبعت expectedUpdatedAt؛ صفر صفوف متحدّثة = conflict.
 * actorUserId مسيوب مكانه لحد ما الـ auth تجهز — ومش بنزيّف هوية دلوقتي.
 */
export type SaveResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'conflict' | 'validation' | 'error'; message: string }

export interface AdminMutations {
  saveProduct(input: Partial<AdminProduct> & { id?: number; expectedUpdatedAt?: string }): Promise<SaveResult<AdminProduct>>
  setProductVisibility(id: number, visible: boolean, expectedUpdatedAt: string): Promise<SaveResult<AdminProduct>>
  reorderProducts(orderedIds: number[]): Promise<SaveResult<null>>

  uploadProductImage(productId: number, file: File): Promise<SaveResult<AdminImage>>
  setPrimaryImage(productId: number, imageId: number): Promise<SaveResult<null>>
  setImageFit(imageId: number, fit: ImageFit): Promise<SaveResult<null>>
  reorderImages(productId: number, orderedIds: number[]): Promise<SaveResult<null>>
  deleteImage(imageId: number): Promise<SaveResult<null>>

  updateOrderStatus(orderId: number, status: OrderStatus): Promise<SaveResult<null>>
  addOrderNote(orderId: number, note: string): Promise<SaveResult<null>>
  resendNotification(orderId: number): Promise<SaveResult<null>>

  saveContent(patch: Partial<StoreContent>): Promise<SaveResult<StoreContent>>
  saveShipping(patch: Partial<ShippingSettings>): Promise<SaveResult<ShippingSettings>>
  saveIdentity(patch: Partial<StoreIdentity>): Promise<SaveResult<StoreIdentity>>
  /** telegramToken مدخل فقط — ما بيترجعش أبدًا */
  saveOperationalSettings(patch: { notifyEmail?: string; telegramToken?: string }): Promise<SaveResult<OperationalSettings>>

  revalidateStorefront(): Promise<SaveResult<null>>
}

/** المصدر الحالي: بيانات ثابتة للمراجعة البصرية. */
export const adminData: AdminDataSource = fallbackAdminData

/** المرحلة أ: كل تعديل معطّل. الصفحات بتقرا ده عشان تعرض السبب. */
export const MUTATIONS_ENABLED = false
