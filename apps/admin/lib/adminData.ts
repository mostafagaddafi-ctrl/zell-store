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
  /** الزبون طلب فني تركيب (علامة أول سطر في الملاحظات). */
  needsInstaller?: boolean
}

export type AdminOrderItem = {
  productNameAr: string
  /** null لسطر القطعة (0016). */
  lengthCm: number | null
  widthCm: number | null
  unitPricePiastres: number
  lineTotalPiastres: number
  saleUnit: 'meter' | 'piece'
  quantity: number
}

export type AdminOrderDetail = AdminOrder & {
  address: string
  notes: string | null
  /** ملاحظات الأدمن — مابتظهرش للزبون في أي مكان. */
  internalNotes: string | null
  subtotalPiastres: number
  shippingPiastres: number
  items: AdminOrderItem[]
  /** رمز التعارض لتعديل الحالة والملاحظات الداخلية. */
  updatedAt: string
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
  /**
   * نص مش رقم. أعمدة bigint في Postgres بتترجع strings في JSON عشان
   * ما تتكسرش دقة Number.MAX_SAFE_INTEGER — فالمعرّف بيتعامل كنص
   * من أول القراءة لحد التعديل.
   */
  id: string
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
  /** 0013 — الزبون مايكتبش عرض الشباك، والعرض بيظهر مقفول على widthCm. */
  lockWidth: boolean
  /** 0014 — السعر قبل الخصم بالقرش. null = مفيش خصم. */
  compareAtPiastres: number | null
  /** 0016 — بالمتر أو بالقطعة. القطعة: pricePerMeterPiastres = سعر القطعة. */
  saleUnit: 'meter' | 'piece'
  /** 0016 — يظهر في الرئيسية والأقسام. */
  isListed: boolean
  /** 0016 — أقصى عدد لمنتج القطعة. */
  maxQuantity: number
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
  /**
   * أحدث updated_at بين الستة مفاتيح — رمز التعارض للحفظ.
   * نص فاضي = الطابع مش متاح، والحفظ لازم يترفض VALIDATION بدل
   * ما يكتب من غير تحقق.
   */
  updatedAt: string
  announcement: Announcement
}

// ── الشحن والهوية والتشغيل ───────────────────────────────────
export type ShippingSettings = {
  rates: Record<string, number>
  defaultPiastres: number
  freeThresholdPiastres: number
  /** المحافظات الموقوفة — مفتاح shipping_disabled_governorates. */
  disabled: string[]
  /** أحدث updated_at بين مفاتيح الشحن الأربعة — رمز التعارض للحفظ. */
  updatedAt: string
}

export type StoreIdentity = {
  storeName: string
  logo: AdminImage | null
  /** صورة الواجهة النشطة (site_images kind = 'hero'). */
  heroImage: AdminImage | null
  offerText: string
  /** settings.offer_enabled — مش موجود = ظاهر. مش داخل في حفظ الهوية. */
  offerEnabled?: boolean
  whatsappNumber: string
  whatsappMessage: string
  /**
   * أحدث updated_at بين **أربعة** مفاتيح بس: الاسم ونص العرض ورقم
   * ورسالة الواتساب. اللوجو مش داخل — zell_save_identity مابتلمسهوش.
   */
  updatedAt: string
}

/**
 * تلات حالات مش اتنين. `unknown` ضرورية: «مش عارفين» **مش** نفس «سليم» ولا
 * «فيه مشكلة»، وخلطها بأي واحدة فيهم بيدّي مؤشر كذّاب.
 */
export type Announcement = {
  enabled: boolean
  text: string
  href: string
  ctaLabel: string
}

/**
 * مجموعة منتجات (0010).
 *
 * productIds مرتّبة بـ sort_order من جدول الربط.
 * productCount موجود في القائمة عشان نتجنّب جلب الروابط كلها
 * في صفحة القائمة.
 */
export type AdminCollection = {
  id: string
  slug: string
  title: string
  subtitle: string
  /** يظهر كجزء مستقل في الرئيسية. */
  showOnHome: boolean
  /** يظهر في التنقل وليه صفحة /collection/[slug]. */
  showInNav: boolean
  sortOrder: number
  productCount: number
  /** المنتجات النشطة بس — صفر معناه القسم مش ظاهر للزباين حتى لو مفعّل. */
  activeProductCount: number
  /** null = مفيش غلاف، والمتجر بيستخدم أول صورة لأول منتج ظاهر. */
  cover: AdminImage | null
  updatedAt: string
}

export type AdminCollectionDetail = AdminCollection & { productIds: number[] }

export type ReadinessState = 'ok' | 'warn' | 'unknown'

export type ReadinessCheck = {
  key: string
  label: string
  /** مشتق من state: `state === 'ok'` بالظبط. باقي للتوافق مع أي عرض قديم. */
  ok: boolean
  state: ReadinessState
  detail: string
}

/**
 * صحة **تسليم** الإشعارات — مش «تليجرام متظبط».
 *
 * ⚠️ اللوحة ما بتقراش أي سر، و**مستحيل** تعرف متغيرات بيئة المتجر: الاتنين
 *    مشروعين Vercel منفصلين بمتغيرات منفصلة. فالمؤشر بيتقاس من **الأثر**
 *    (نتيجة التسليم في `orders`) مش من الإعداد.
 */
export type NotifyDeliveryHealth = {
  state: ReadinessState
  /** طول النافذة بالساعات — موثّق في reads.ts مع مصدر الرقم. */
  windowHours: number
  /**
   * أعداد **دقيقة** من هيدر Content-Range، مش طول مصفوفة.
   * ⚠️ لو countsExact = false الأرقام دي مش موثوقة وممنوع تتعرض كحقيقة.
   */
  recentOrders: number
  failedOrders: number
  /**
   * هل العدّ الدقيق وصل فعلاً؟ `false` = fail-closed: الحالة بتبقى `unknown`
   * وممنوع تبقى `ok` مهما كانت الأرقام.
   */
  countsExact: boolean
}

export type OperationalSettings = {
  notifyEmail: string
  notifyDelivery: NotifyDeliveryHealth
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
  listCollections(): Promise<AdminCollection[]>
  getCollection(id: string): Promise<AdminCollectionDetail | null>
  getOperationalSettings(): Promise<OperationalSettings>
}

/** قراءة حقيقية من Production. التعديلات في lib/actions.ts وكلها موقوفة. */
export const adminData: AdminDataSource = supabaseAdminData
