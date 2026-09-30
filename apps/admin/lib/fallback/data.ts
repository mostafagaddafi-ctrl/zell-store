/**
 * ⚠️ بيانات ثابتة للمراجعة البصرية — **مش مصدر بيانات**.
 *
 * قيم المنتجات والشحن منسوخة من Production عشان الشاشات تتراجع بأرقام
 * حقيقية. الطلبات **مؤلّفة** لأن Production فيه صفر طلبات ومينفعش نراجع
 * جدول فاضي — كل أسماء العملاء وأرقامهم هنا وهمية بالكامل.
 *
 * الملف ده بيتحذف لما القراءة الحقيقية تتوصل.
 */
import type {
  AdminDataSource,
  AdminOrder,
  AdminOrderDetail,
  AdminProductDetail,
  OperationalSettings,
  OrdersPage,
  OrdersQuery,
  OrdersSummary,
  ShippingSettings,
  StoreContent,
  StoreIdentity,
} from '../adminData'

const NOW = '2026-09-30T10:00:00.000Z'

// ── المنتجات ─────────────────────────────────────────────────
const PRODUCTS: AdminProductDetail[] = [
  {
    id: 1,
    nameAr: 'عازل حرارة',
    nameEn: 'Heat Rejection Window Film',
    brand: '',
    descriptionAr:
      'الصالة أو الأوضة اللي الشمس بتضربها طول النهار: بيقلل الحرارة والوهج، والتكييف يتعب أقل، والفرش ما يبهتش. الرؤية من جوه تفضل واضحة.',
    shortBenefit: 'بيقلل الحرارة والوهج والرؤية تفضل واضحة',
    benefits: ['بيقلل الحرارة والوهج', 'التكييف يتعب أقل', 'الفرش ما يبهتش', 'الرؤية من جوه تفضل واضحة'],
    pricePerMeterPiastres: 18000,
    widthCm: 50,
    minLengthCm: 300,
    stepCm: 50,
    maxLengthCm: 3000,
    isActive: true,
    sortOrder: 1,
    imageCount: 5,
    updatedAt: NOW,
    images: [],
  },
  {
    id: 2,
    nameAr: 'مصنفر (خصوصية)',
    nameEn: 'Frosted Privacy Film',
    brand: '',
    descriptionAr:
      'زجاج مطفي زي السنفرة — محدش يشوف من بره والنور بيدخل عادي. الأنسب للحمام والمطبخ والأبواب الزجاجية الداخلية.',
    shortBenefit: 'خصوصية كاملة والنور بيدخل عادي',
    benefits: ['محدش يشوف من بره', 'النور بيدخل عادي', 'مناسب للحمام والمطبخ', 'للأبواب الزجاجية الداخلية'],
    pricePerMeterPiastres: 12000,
    widthCm: 50,
    minLengthCm: 300,
    stepCm: 50,
    maxLengthCm: 3000,
    isActive: true,
    sortOrder: 2,
    imageCount: 5,
    updatedAt: NOW,
    images: [],
  },
  {
    id: 3,
    nameAr: 'فاميه أسود',
    nameEn: 'Black Smoked Film',
    brand: '',
    descriptionAr: 'تعتيم قوي وخصوصية كاملة من بره، وبيقلل الشمس والوهج كمان. مناسب للبلكونة والشبابيك المطلة على الشارع.',
    shortBenefit: 'تعتيم قوي وخصوصية من بره',
    benefits: ['تعتيم قوي وخصوصية كاملة', 'بيقلل الشمس والوهج', 'مناسب للبلكونة', 'للشبابيك المطلة على الشارع'],
    pricePerMeterPiastres: 20000,
    widthCm: 50,
    minLengthCm: 300,
    stepCm: 50,
    maxLengthCm: 3000,
    isActive: true,
    sortOrder: 3,
    imageCount: 5,
    updatedAt: NOW,
    images: [],
  },
  {
    id: 4,
    nameAr: 'زجاج ما يتكسرش على أطفالك',
    nameEn: 'Safety & Security Film',
    brand: '',
    descriptionAr: 'لو الزجاج اتكسر، الفيلم بيمسك الشظايا مكانها. أمان للأطفال وللأبواب والشبابيك الزجاجية الكبيرة.',
    shortBenefit: '',
    benefits: [],
    pricePerMeterPiastres: 24000,
    widthCm: 50,
    minLengthCm: 300,
    stepCm: 50,
    maxLengthCm: 3000,
    isActive: false,
    sortOrder: 4,
    imageCount: 0,
    updatedAt: NOW,
    images: [],
  },
]

// خانات الصور: بدون روابط حقيقية — الواجهة بتعرض خانة فاضية
for (const product of PRODUCTS) {
  if (product.imageCount === 0) continue
  product.images = Array.from({ length: product.imageCount }, (_, index) => ({
    id: product.id * 100 + index,
    url: '',
    alt: index === 0 ? product.nameAr + ' — على الشباك' : product.nameAr + ' — الخامة',
    fit: index === 0 ? ('cover' as const) : ('contain' as const),
    sortOrder: index,
    isPrimary: index === 0,
    width: 1024,
    height: 1024,
    updatedAt: NOW,
  }))
}

// ── الطلبات (مؤلّفة بالكامل) ─────────────────────────────────
const ORDERS: AdminOrderDetail[] = [
  {
    id: 101,
    orderNumber: 'FLM-K7M2XQ',
    status: 'new',
    customerName: 'عميل تجريبي ١',
    customerPhone: '01000000001',
    governorate: 'القاهرة',
    address: 'مدينة نصر، شارع مصطفى النحاس، عمارة ١٢، الدور ٣',
    notes: 'يفضل التوصيل بعد العصر',
    internalNotes: null,
    itemCount: 2,
    subtotalPiastres: 99000,
    shippingPiastres: 5000,
    totalPiastres: 104000,
    notifiedAt: null,
    notifyError: 'لم يتم ضبط إيميل الإشعارات',
    createdAt: '2026-09-30T08:20:00.000Z',
    items: [
      { productNameAr: 'عازل حرارة', lengthCm: 450, widthCm: 50, unitPricePiastres: 18000, lineTotalPiastres: 81000 },
      { productNameAr: 'مصنفر (خصوصية)', lengthCm: 150, widthCm: 50, unitPricePiastres: 12000, lineTotalPiastres: 18000 },
    ],
  },
  {
    id: 102,
    orderNumber: 'FLM-B4RT9N',
    status: 'confirmed',
    customerName: 'عميل تجريبي ٢',
    customerPhone: '01100000002',
    governorate: 'الجيزة',
    address: 'الدقي، شارع التحرير، برج النيل، الدور ٧',
    notes: null,
    internalNotes: 'اتأكد من المقاس على التليفون قبل الشحن',
    itemCount: 1,
    subtotalPiastres: 60000,
    shippingPiastres: 5000,
    totalPiastres: 65000,
    notifiedAt: '2026-09-29T19:05:00.000Z',
    notifyError: null,
    createdAt: '2026-09-29T18:40:00.000Z',
    items: [
      { productNameAr: 'فاميه أسود', lengthCm: 300, widthCm: 50, unitPricePiastres: 20000, lineTotalPiastres: 60000 },
    ],
  },
  {
    id: 103,
    orderNumber: 'FLM-D8W3JP',
    status: 'shipped',
    customerName: 'عميل تجريبي ٣',
    customerPhone: '01200000003',
    governorate: 'الإسكندرية',
    address: 'سيدي جابر، شارع أبو قير، عمارة ٤٥',
    notes: null,
    internalNotes: null,
    itemCount: 3,
    subtotalPiastres: 150000,
    shippingPiastres: 7000,
    totalPiastres: 157000,
    notifiedAt: '2026-09-28T12:10:00.000Z',
    notifyError: null,
    createdAt: '2026-09-28T11:55:00.000Z',
    items: [
      { productNameAr: 'عازل حرارة', lengthCm: 500, widthCm: 50, unitPricePiastres: 18000, lineTotalPiastres: 90000 },
      { productNameAr: 'مصنفر (خصوصية)', lengthCm: 300, widthCm: 50, unitPricePiastres: 12000, lineTotalPiastres: 36000 },
      { productNameAr: 'فاميه أسود', lengthCm: 120, widthCm: 50, unitPricePiastres: 20000, lineTotalPiastres: 24000 },
    ],
  },
  {
    id: 104,
    orderNumber: 'FLM-Q2ZK6V',
    status: 'delivered',
    customerName: 'عميل تجريبي ٤',
    customerPhone: '01500000004',
    governorate: 'الدقهلية',
    address: 'المنصورة، شارع الجمهورية، بجوار المستشفى العام',
    notes: null,
    internalNotes: null,
    itemCount: 1,
    subtotalPiastres: 36000,
    shippingPiastres: 7000,
    totalPiastres: 43000,
    notifiedAt: '2026-09-25T09:30:00.000Z',
    notifyError: null,
    createdAt: '2026-09-25T09:15:00.000Z',
    items: [
      { productNameAr: 'مصنفر (خصوصية)', lengthCm: 300, widthCm: 50, unitPricePiastres: 12000, lineTotalPiastres: 36000 },
    ],
  },
  {
    id: 105,
    orderNumber: 'FLM-H9N4TC',
    status: 'cancelled',
    customerName: 'عميل تجريبي ٥',
    customerPhone: '01000000005',
    governorate: 'أسيوط',
    address: 'شارع الجمهورية، أمام كلية الطب',
    notes: 'العميل غيّر رأيه',
    internalNotes: 'مردش على ٣ محاولات',
    itemCount: 1,
    subtotalPiastres: 54000,
    shippingPiastres: 9000,
    totalPiastres: 63000,
    notifiedAt: '2026-09-24T14:00:00.000Z',
    notifyError: null,
    createdAt: '2026-09-24T13:45:00.000Z',
    items: [
      { productNameAr: 'عازل حرارة', lengthCm: 300, widthCm: 50, unitPricePiastres: 18000, lineTotalPiastres: 54000 },
    ],
  },
]

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

const CONTENT: StoreContent = {
  hero: {
    title: 'أفلام حماية الزجاج،',
    accent: 'بالمتر',
    subtitle:
      'عزل حرارة، خصوصية، وتعتيم لشبابيك البيت. تدخل مقاس الشباك وإحنا نحسب الطول، والدفع عند الاستلام لكل محافظات مصر.',
    ctaLabel: 'اختار نوع الفيلم',
  },
  orderSteps: [
    { title: 'اختار النوع والمقاس', description: 'بمقاس الشباك أو بالمتر' },
    { title: 'أكّد الطلب', description: 'أربع خانات بس' },
    { title: 'ادفع عند الاستلام', description: 'تشوف الشحنة الأول' },
  ],
  faqs: [
    {
      question: 'الفيلم بيتباع إزاي؟',
      answer:
        'الفيلم بيتباع بالمتر الطولي. لو الشباك أعرض من عرض الرول، بنقسمه شرايح والطول بيتحسب تلقائيًا. إنت بس تدخل عرض وارتفاع الشباك وإحنا نحسبلك الكمية المطلوبة.',
    },
    {
      question: 'التركيب بيتم إزاي؟',
      answer: 'أدوات التركيب بتيجي مع الطلب مع شرح بالخطوات. الفيلم بيتركب بالمياه والصابون ومحتاجش فني.',
    },
    { question: 'الدفع إزاي؟', answer: 'الدفع عند الاستلام لكل المحافظات. تشوف الشحنة وتدفع للمندوب.' },
    {
      question: 'لو مش متأكد من المقاس؟',
      answer: 'كلّمنا على واتساب قبل الطلب، وإحنا نساعدك تحسب المقاس والكمية المناسبة.',
    },
  ],
  sections: [
    { key: 'hero', visible: true, sortOrder: 1 },
    { key: 'products', visible: true, sortOrder: 2, title: 'اختار نوع الفيلم', subtitle: 'ثلاث خامات، والسعر بالمتر الطولي.' },
    { key: 'how_it_works', visible: true, sortOrder: 3 },
    { key: 'faq', visible: true, sortOrder: 4, title: 'أسئلة متكررة' },
  ],
  footerLinks: [
    { label: 'سياسة الشحن والتوصيل', href: '' },
    { label: 'الاستبدال والاسترجاع', href: '' },
    { label: 'سياسة الخصوصية', href: '' },
  ],
  trustLine: 'الدفع عند الاستلام · توصيل لكل محافظات مصر',
}

const IDENTITY: StoreIdentity = {
  storeName: 'ZELL',
  logo: { id: 1, url: '', alt: 'شعار زِل', fit: 'contain', sortOrder: 0, isPrimary: true, width: 1024, height: 1024, updatedAt: NOW },
  offerText: 'أدوات التركيب مرفقة مجاناً',
  whatsappNumber: '201000000000',
  whatsappMessage: 'مرحباً ZELL، عايز أستفسر عن فيلم زجاج للبيت',
}

function toListRow(order: AdminOrderDetail): AdminOrder {
  const { address: _a, notes: _n, internalNotes: _i, items: _it, subtotalPiastres: _s, shippingPiastres: _sh, ...row } = order
  return row
}

export const fallbackAdminData: AdminDataSource = {
  async listOrders(query: OrdersQuery): Promise<OrdersPage> {
    const search = (query.search ?? '').trim().toLowerCase()
    const filtered = ORDERS.filter((order) => {
      if (query.status && query.status !== 'all' && order.status !== query.status) return false
      if (search === '') return true
      return (
        order.orderNumber.toLowerCase().includes(search) ||
        order.customerName.toLowerCase().includes(search) ||
        order.customerPhone.includes(search) ||
        order.governorate.includes(search)
      )
    })
    const page = Math.max(1, query.page)
    const pageSize = Math.max(1, query.pageSize)
    const start = (page - 1) * pageSize
    return {
      rows: filtered.slice(start, start + pageSize).map(toListRow),
      total: filtered.length,
      page,
      pageSize,
    }
  },

  async getOrder(orderNumber: string): Promise<AdminOrderDetail | null> {
    return ORDERS.find((order) => order.orderNumber === orderNumber) ?? null
  },

  async getOrdersSummary(): Promise<OrdersSummary> {
    const active = ORDERS.filter((order) => order.status !== 'cancelled')
    return {
      newCount: ORDERS.filter((order) => order.status === 'new').length,
      todayCount: 1,
      totalOrders: ORDERS.length,
      salesPiastres: active.reduce((sum, order) => sum + order.totalPiastres, 0),
      salesMonthPiastres: active.reduce((sum, order) => sum + order.totalPiastres, 0),
    }
  },

  async listProducts() {
    return PRODUCTS.map(({ images: _images, ...product }) => product).sort((a, b) => a.sortOrder - b.sortOrder)
  },

  async getProduct(id: number) {
    return PRODUCTS.find((product) => product.id === id) ?? null
  },

  async getContent(): Promise<StoreContent> {
    return CONTENT
  },

  async getShipping(): Promise<ShippingSettings> {
    return { rates: SHIPPING_RATES, defaultPiastres: 8000, freeThresholdPiastres: 0, disabled: [] }
  },

  async getIdentity(): Promise<StoreIdentity> {
    return IDENTITY
  },

  async getOperationalSettings(): Promise<OperationalSettings> {
    return {
      notifyEmail: '',
      telegramConfigured: false,
      readiness: [
        { key: 'notifications', label: 'إشعارات الطلبات', ok: false, detail: 'مفيش إيميل إشعارات متظبط' },
        { key: 'orders_api', label: 'استقبال الطلبات', ok: false, detail: 'إنشاء الطلب لسه معطّل في المتجر' },
        { key: 'products', label: 'المنتجات النشطة', ok: true, detail: '٣ منتجات نشطة' },
        { key: 'images', label: 'صور المنتجات', ok: true, detail: 'كل المنتجات النشطة ليها صور' },
        { key: 'shipping', label: 'جدول الشحن', ok: true, detail: '٢٧ محافظة مضبوطة' },
        { key: 'whatsapp', label: 'رقم واتساب', ok: true, detail: '201000000000' },
      ],
    }
  },
}
