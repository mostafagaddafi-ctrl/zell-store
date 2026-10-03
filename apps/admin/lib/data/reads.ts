import 'server-only'

import type {
  AdminCollection,
  AdminCollectionDetail,
  AdminDataSource,
  AdminImage,
  AdminOrderDetail,
  AdminProduct,
  AdminProductDetail,
  OperationalSettings,
  OrdersPage,
  OrdersQuery,
  OrdersSummary,
  ReadinessCheck,
  ReadinessState,
  ShippingSettings,
  StoreContent,
  StoreIdentity,
} from '../adminData'
import { inFilter, projectUrl, restGet } from './client'
import {
  latestUpdatedAt,
  readFaqs,
  readFooterLinks,
  readHero,
  readNumber,
  readOrderSteps,
  readRates,
  readSections,
  readString,
  readStringList,
  settingsMap,
  toAdminCollection,
  toAdminImage,
  toAdminSiteImage,
  toAdminOrder,
  toAdminOrderItem,
  toAdminProduct,
  type CollectionRow,
  type OrderItemRow,
  type ProductCollectionRow,
  type OrderRow,
  type ProductImageRow,
  type ProductRow,
  type SettingRow,
  type SiteImageRow,
  COLLECTION_SELECT,
} from './rows'

const COLLECTION_COLUMNS = COLLECTION_SELECT

const PRODUCT_COLUMNS = [
  'id',
  'name_ar',
  'name_en',
  'brand',
  'description_ar',
  'short_benefit',
  'benefits',
  'price_per_meter_piastres',
  'width_cm',
  'lock_width',
  'compare_at_piastres',
  'min_length_cm',
  'step_cm',
  'max_length_cm',
  'is_active',
  'sort_order',
  'updated_at',
].join(',')

const IMAGE_COLUMNS = [
  'id',
  'product_id',
  'bucket',
  'object_path',
  'kind',
  'alt_text',
  'fit',
  'sort_order',
  'is_primary',
  'width_px',
  'height_px',
  'updated_at',
].join(',')

const ORDER_COLUMNS = [
  'id',
  'order_number',
  'status',
  'customer_name',
  'customer_phone',
  'governorate',
  'address',
  'notes',
  'internal_notes',
  'subtotal_piastres',
  'shipping_piastres',
  'total_piastres',
  'notified_at',
  'notify_error',
  'created_at',
  'updated_at',
].join(',')

const CONTENT_KEYS = [
  'hero',
  'order_steps',
  'faqs',
  'sections',
  'footer_links',
  'trust_line',
  'announcement',
] as const
const SHIPPING_KEYS = [
  'shipping_rates',
  'shipping_default_piastres',
  'free_shipping_threshold_piastres',
  'shipping_disabled_governorates',
] as const
const IDENTITY_KEYS = ['store_name', 'logo_url', 'offer_text', 'offer_enabled', 'whatsapp_number', 'whatsapp_message'] as const

/**
 * المفاتيح اللي zell_save_identity بتقفلها وبتقارن عليها.
 * logo_url **مش** فيهم عن قصد: لو كان، أي تغيير للوجو كان هيدي
 * CONFLICT وهمي لكل حفظ هوية.
 */
const IDENTITY_SAVE_KEYS = ['store_name', 'offer_text', 'whatsapp_number', 'whatsapp_message'] as const
/**
 * ⚠️ `telegram_bot_token` **اتشال من هنا** عن قصد (ب١٩). الأسرار بقت في
 *    متغيرات بيئة المتجر على Vercel، واللوحة مالهاش أي داعي تقرا سر —
 *    ولا تقدر أصلاً تشوف متغيرات مشروع تاني.
 */
const OPERATIONAL_KEYS = ['notify_email', 'whatsapp_number'] as const

/**
 * نافذة «الطلبات الحديثة» لقياس صحة التسليم.
 *
 * ٢٤ ساعة **مش رقم مختار عشوائي**: هي نفس النافذة المستخدمة فعلاً في
 * `zell_create_order` لحد الطلبات لكل رقم موبايل (`interval '24 hours'`)،
 * والموثّقة في ORDER-FLOW-PLAN.md §5.2. استخدام نفس النافذة بيخلّي معنى
 * «حديث» واحد في النظام كله.
 */
const NOTIFY_WINDOW_HOURS = 24

/** حد أعلى للمجاميع لحد ما ييجي view أو RPC للتجميع. */
const SUMMARY_ROW_CAP = 2000

function sanitizeSearch(value: string): string {
  return value.replace(/[%,()*]/g, ' ').trim()
}

export const supabaseAdminData: AdminDataSource = {
  async listOrders(query: OrdersQuery): Promise<OrdersPage> {
    const page = Math.max(1, Math.floor(query.page))
    const pageSize = Math.max(1, Math.floor(query.pageSize))
    const offset = (page - 1) * pageSize

    const parts = [
      'select=' + ORDER_COLUMNS,
      'order=created_at.desc,id.desc',
      'limit=' + String(pageSize),
      'offset=' + String(offset),
    ]

    if (query.status && query.status !== 'all') parts.push('status=eq.' + query.status)

    const search = sanitizeSearch(query.search ?? '')
    if (search !== '') {
      const term = encodeURIComponent('*' + search + '*')
      parts.push(
        'or=(order_number.ilike.' +
          term +
          ',customer_name.ilike.' +
          term +
          ',customer_phone.ilike.' +
          term +
          ',governorate.ilike.' +
          term +
          ')',
      )
    }

    const result = await restGet<OrderRow>('orders', parts.join('&'), { exactCount: true })

    // عدد الأصناف لصفوف الصفحة الحالية بس
    const ids = result.rows.map((row) => row.id)
    const counts = new Map<number, number>()
    if (ids.length > 0) {
      const items = await restGet<{ order_id: number }>(
        'order_items',
        'select=order_id&order_id=in.(' + ids.join(',') + ')',
      )
      for (const item of items.rows) counts.set(item.order_id, (counts.get(item.order_id) ?? 0) + 1)
    }

    return {
      rows: result.rows.map((row) => toAdminOrder(row, counts.get(row.id) ?? 0)),
      total: result.total ?? result.rows.length,
      page,
      pageSize,
    }
  },

  async getOrder(orderNumber: string): Promise<AdminOrderDetail | null> {
    const found = await restGet<OrderRow>(
      'orders',
      'select=' + ORDER_COLUMNS + '&order_number=eq.' + encodeURIComponent(orderNumber) + '&limit=1',
    )
    const row = found.rows[0]
    if (!row) return null

    const items = await restGet<OrderItemRow>(
      'order_items',
      'select=order_id,product_name_ar,length_cm,width_cm,unit_price_piastres,line_total_piastres&order_id=eq.' +
        String(row.id) +
        '&order=id.asc',
    )

    return {
      ...toAdminOrder(row, items.rows.length),
      address: row.address,
      notes: row.notes,
      internalNotes: row.internal_notes,
      updatedAt: row.updated_at,
      subtotalPiastres: row.subtotal_piastres,
      shippingPiastres: row.shipping_piastres,
      items: items.rows.map(toAdminOrderItem),
    }
  },

  async getOrdersSummary(): Promise<OrdersSummary> {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1)

    const [total, newOrders, today, amounts] = await Promise.all([
      restGet<{ id: number }>('orders', 'select=id&limit=1', { exactCount: true }),
      restGet<{ id: number }>('orders', 'select=id&status=eq.new&limit=1', { exactCount: true }),
      restGet<{ id: number }>(
        'orders',
        'select=id&created_at=gte.' + encodeURIComponent(startOfDay.toISOString()) + '&limit=1',
        { exactCount: true },
      ),
      // مؤقت بموافقة: التجميع على الواجهة بحد صفوف. محتاج view أو RPC قبل النمو.
      restGet<{ total_piastres: number; created_at: string }>(
        'orders',
        'select=total_piastres,created_at&status=neq.cancelled&limit=' + String(SUMMARY_ROW_CAP),
      ),
    ])

    let sales = 0
    let salesMonth = 0
    for (const row of amounts.rows) {
      sales += row.total_piastres
      if (new Date(row.created_at) >= startOfMonth) salesMonth += row.total_piastres
    }

    return {
      newCount: newOrders.total ?? 0,
      todayCount: today.total ?? 0,
      totalOrders: total.total ?? 0,
      salesPiastres: sales,
      salesMonthPiastres: salesMonth,
    }
  },

  async listProducts(): Promise<AdminProduct[]> {
    const [products, images] = await Promise.all([
      restGet<ProductRow>('products', 'select=' + PRODUCT_COLUMNS + '&order=sort_order.asc,id.asc'),
      restGet<{ product_id: number }>('product_images', 'select=product_id&kind=eq.gallery'),
    ])

    const counts = new Map<number, number>()
    for (const image of images.rows) counts.set(image.product_id, (counts.get(image.product_id) ?? 0) + 1)

    return products.rows.map((row) => toAdminProduct(row, counts.get(row.id) ?? 0))
  },

  async getProduct(id: number): Promise<AdminProductDetail | null> {
    if (!Number.isFinite(id)) return null

    const found = await restGet<ProductRow>('products', 'select=' + PRODUCT_COLUMNS + '&id=eq.' + String(id) + '&limit=1')
    const row = found.rows[0]
    if (!row) return null

    const images = await restGet<ProductImageRow>(
      'product_images',
      'select=' +
        IMAGE_COLUMNS +
        '&product_id=eq.' +
        String(id) +
        '&kind=eq.gallery&order=is_primary.desc,sort_order.asc,id.asc',
    )

    const url = projectUrl()
    const mapped: AdminImage[] = images.rows.map((image) => toAdminImage(image, url, row.name_ar))

    return { ...toAdminProduct(row, mapped.length), images: mapped }
  },

  /**
   * الستة مفاتيح بتتقرا مع طوابعها، وأحدث طابع بيبقى رمز التعارض
   * للحفظ (expectedUpdatedAt إلزامي في saveContentAction).
   */
  async getContent(): Promise<StoreContent> {
    const rows = await restGet<SettingRow>('settings', 'select=key,value,updated_at&key=' + inFilter(CONTENT_KEYS))
    const map = settingsMap(rows.rows)

    const rawBar = map.get('announcement')
    const bar = typeof rawBar === 'object' && rawBar !== null && !Array.isArray(rawBar)
      ? (rawBar as Record<string, unknown>)
      : {}

    return {
      announcement: {
        enabled: bar['enabled'] === true,
        text: typeof bar['text'] === 'string' ? bar['text'] : '',
        href: typeof bar['href'] === 'string' ? bar['href'] : '',
        ctaLabel: typeof bar['ctaLabel'] === 'string' ? bar['ctaLabel'] : '',
      },
      hero: readHero(map),
      orderSteps: readOrderSteps(map),
      faqs: readFaqs(map),
      sections: readSections(map),
      footerLinks: readFooterLinks(map),
      trustLine: readString(map, 'trust_line'),
      updatedAt: latestUpdatedAt(rows.rows, CONTENT_KEYS),
    }
  },

  async getShipping(): Promise<ShippingSettings> {
    const rows = await restGet<SettingRow>('settings', 'select=key,value,updated_at&key=' + inFilter(SHIPPING_KEYS))
    const map = settingsMap(rows.rows)

    return {
      rates: readRates(map, 'shipping_rates'),
      defaultPiastres: readNumber(map, 'shipping_default_piastres'),
      freeThresholdPiastres: readNumber(map, 'free_shipping_threshold_piastres'),
      disabled: readStringList(map, 'shipping_disabled_governorates'),
      updatedAt: latestUpdatedAt(rows.rows, SHIPPING_KEYS),
    }
  },

  /**
   * قائمة المجموعات + عدد منتجات كل واحدة.
   *
   * ⚠️ طلبين بس: المجموعات، وكل الروابط. العدّ بيتعمل في الذاكرة.
   *    ممكن كان embedded count من PostgREST، بس ده بيربط القراءة بشكل
   *    علاقة بيستنتجها PostgREST — وطلب واحد على جدول صغير أوضح وأثبت.
   */
  async listCollections(): Promise<AdminCollection[]> {
    const [rows, links, products] = await Promise.all([
      restGet<CollectionRow>('collections', 'select=' + COLLECTION_COLUMNS + '&order=sort_order.asc,id.asc'),
      restGet<{ collection_id: string; product_id: number }>('product_collections', 'select=collection_id,product_id'),
      restGet<{ id: number; is_active: boolean }>('products', 'select=id,is_active'),
    ])

    // العدّ الكلي والنشط — النشط هو اللي بيحدد القسم ظاهر للزباين ولا لأ
    const active = new Set(products.rows.filter((product) => product.is_active).map((product) => product.id))
    const counts = new Map<string, { total: number; active: number }>()
    for (const link of links.rows) {
      const key = String(link.collection_id)
      const current = counts.get(key) ?? { total: 0, active: 0 }
      current.total += 1
      if (active.has(link.product_id)) current.active += 1
      counts.set(key, current)
    }

    return rows.rows.map((row) =>
      toAdminCollection(row, counts.get(String(row.id)) ?? { total: 0, active: 0 }, projectUrl()),
    )
  },

  async getCollection(id: string): Promise<AdminCollectionDetail | null> {
    const filter = 'collection_id=eq.' + encodeURIComponent(id)
    const [rows, links, products] = await Promise.all([
      restGet<CollectionRow>(
        'collections',
        'select=' + COLLECTION_COLUMNS + '&id=eq.' + encodeURIComponent(id) + '&limit=1',
      ),
      restGet<ProductCollectionRow>(
        'product_collections',
        'select=collection_id,product_id,sort_order&' + filter + '&order=sort_order.asc,product_id.asc',
      ),
      restGet<{ id: number; is_active: boolean }>('products', 'select=id,is_active'),
    ])

    const row = rows.rows[0]
    if (!row) return null

    const active = new Set(products.rows.filter((product) => product.is_active).map((product) => product.id))
    const productIds = links.rows.map((link) => link.product_id)
    const counts = { total: productIds.length, active: productIds.filter((productId) => active.has(productId)).length }
    return { ...toAdminCollection(row, counts, projectUrl()), productIds }
  },

  async getIdentity(): Promise<StoreIdentity> {
    const [rows, siteImages] = await Promise.all([
      restGet<SettingRow>('settings', 'select=key,value,updated_at&key=' + inFilter(IDENTITY_KEYS)),
      // اللوجو وصورة الواجهة في طلب واحد. 0009 بيضمن نشط واحد لكل نوع،
      // و id.desc دفاعي لو الفهرس الفريد اتكسر يومًا ما.
      restGet<SiteImageRow>(
        'site_images',
        'select=id,bucket,object_path,kind,alt_text,width_px,height_px,updated_at&kind=in.(logo,hero)&is_active=eq.true&order=id.desc',
      ),
    ])

    const map = settingsMap(rows.rows)
    const storeName = readString(map, 'store_name', 'ZELL')
    const logoRow = siteImages.rows.find((row) => row.kind === 'logo')
    const heroRow = siteImages.rows.find((row) => row.kind === 'hero')

    return {
      storeName,
      logo: logoRow ? toAdminSiteImage(logoRow, projectUrl(), storeName, 'contain') : null,
      heroImage: heroRow ? toAdminSiteImage(heroRow, projectUrl(), 'صورة الواجهة', 'cover') : null,
      offerText: readString(map, 'offer_text'),
      offerEnabled: map.get('offer_enabled') !== false,
      whatsappNumber: readString(map, 'whatsapp_number'),
      whatsappMessage: readString(map, 'whatsapp_message'),
      updatedAt: latestUpdatedAt(rows.rows, IDENTITY_SAVE_KEYS),
    }
  },

  async getOperationalSettings(): Promise<OperationalSettings> {
    const since = new Date(Date.now() - NOTIFY_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

    const [rows, products, images, shipping, recentAll, recentFailed] = await Promise.all([
      restGet<SettingRow>('settings', 'select=key,value&key=' + inFilter(OPERATIONAL_KEYS)),
      restGet<{ id: number; is_active: boolean }>('products', 'select=id,is_active&order=id.asc'),
      restGet<{ product_id: number }>('product_images', 'select=product_id&kind=eq.gallery'),
      restGet<SettingRow>('settings', 'select=key,value&key=' + inFilter(SHIPPING_KEYS)),
      /**
       * ⚠️ عدّ **دقيق ومحدود**، مش سحب صفوف وعدّها في التطبيق (ب٢٠).
       *
       * PostgREST/Supabase بيحدّدوا أقصى عدد صفوف للرد (شائع ١٠٠٠). لو
       * الطلبات الحديثة عدّت الحد، `rows.length` بيبقى ناقص — **والأخطر** إن
       * أخطاء موجودة بره الصفحة الأولى ما بتتشافش والمؤشر يطلع `ok` كذب.
       *
       * الحل: `limit=1` + `count=exact`، والعدّ بييجي من هيدر Content-Range
       * (`result.total`) مش من طول المصفوفة. صف واحد بيرجع، والعدّ دقيق.
       *
       * `select=id` عن قصد: مفتاح صناعي، **مفيش أي بيانات عميل** في الرد.
       */
      restGet<{ id: number }>(
        'orders',
        'select=id&limit=1&created_at=gte.' + encodeURIComponent(since),
        { exactCount: true },
      ),
      /**
       * `notify_error=not.is.null` بيغطي **كل** قيمة غير null — فالفشل الحقيقي
       * و`NOTIFY_IN_PROGRESS` (حجز اتعلّق) داخلين **تلقائياً**، من غير أي قايمة
       * أكواد لازم تتحدّث كل مرة يضاف كود جديد.
       */
      restGet<{ id: number }>(
        'orders',
        'select=id&limit=1&notify_error=not.is.null&created_at=gte.' + encodeURIComponent(since),
        { exactCount: true },
      ),
    ])

    const map = settingsMap(rows.rows)
    const notifyEmail = readString(map, 'notify_email')
    const whatsapp = readString(map, 'whatsapp_number')

    /**
     * صحة تسليم الإشعارات من **الأثر** مش من الإعداد (ب١٩).
     *
     * `notify_error is not null` بيغطي الفشل الحقيقي **و** `NOTIFY_IN_PROGRESS`
     * (حجز اتعلّق) — الاتنين حالات تستاهل مراجعة، فالاتنين تحذير.
     *
     * ⚠️ صفر طلبات حديثة = `unknown` **مش** `ok`. مفيش تسليم اتم، فمفيش أي دليل
     *    على إن الإشعار شغّال. الادعاء بالسليم هنا هو بالظبط الكذب اللي
     *    المؤشر القديم كان بيعمله.
     */
    /**
     * الأعداد من `total` (هيدر Content-Range) **مش** من `rows.length`.
     *
     * fail-closed: لو أي عدّ رجع null (الهيدر ناقص أو مش مفهوم)، الحالة بتبقى
     * `unknown` و**ممنوع** تبقى `ok`. مؤشر صامت أخطر من مؤشر بيقول «مش عارف».
     */
    const recentTotal = recentAll.total
    const failedTotal = recentFailed.total
    const countsExact = recentTotal !== null && failedTotal !== null

    const recentOrders = recentTotal ?? 0
    const failedOrders = failedTotal ?? 0

    const notifyState: ReadinessState = !countsExact
      ? 'unknown'
      : recentOrders === 0
        ? 'unknown'
        : failedOrders > 0
          ? 'warn'
          : 'ok'

    const notifyDetail = !countsExact
      ? 'ما قدرناش نجيب عدّ دقيق للطلبات — المؤشر مش موثوق دلوقتي'
      : recentOrders === 0
        ? 'مفيش طلبات في آخر ' + String(NOTIFY_WINDOW_HOURS) + ' ساعة — صحة التسليم لسه ما اتأكدتش'
        : failedOrders > 0
          ? String(failedOrders) + ' من ' + String(recentOrders) + ' طلب فيهم فشل إشعار أو إشعار معلّق'
          : 'كل الـ' + String(recentOrders) + ' طلب في آخر ' + String(NOTIFY_WINDOW_HOURS) + ' ساعة وصل إشعارهم'

    const shippingMap = settingsMap(shipping.rows)
    const governorates = Object.keys(readRates(shippingMap, 'shipping_rates')).length
    const shippingDefault = readNumber(shippingMap, 'shipping_default_piastres')

    const withImages = new Set(images.rows.map((image) => image.product_id))
    const active = products.rows.filter((row) => row.is_active)
    const activeWithoutImages = active.filter((row) => !withImages.has(row.id)).length

    const readiness: ReadinessCheck[] = [
      {
        key: 'notify_delivery',
        label: 'تسليم إشعارات الطلبات',
        ok: notifyState === 'ok',
        state: notifyState,
        detail: notifyDetail,
      },
      {
        key: 'products',
        label: 'المنتجات النشطة',
        ok: active.length > 0,
        state: active.length > 0 ? 'ok' : 'warn',
        detail: active.length > 0 ? String(active.length) + ' منتج نشط' : 'مفيش منتجات نشطة',
      },
      {
        key: 'images',
        label: 'صور المنتجات',
        ok: active.length > 0 && activeWithoutImages === 0,
        state: active.length > 0 && activeWithoutImages === 0 ? 'ok' : 'warn',
        detail:
          active.length === 0
            ? 'مفيش منتجات نشطة'
            : activeWithoutImages === 0
              ? 'كل المنتجات النشطة ليها صور'
              : String(activeWithoutImages) + ' منتج من غير صور',
      },
      {
        key: 'shipping',
        label: 'جدول الشحن',
        ok: governorates > 0 && shippingDefault > 0,
        state: governorates > 0 && shippingDefault > 0 ? 'ok' : 'warn',
        detail: governorates > 0 ? String(governorates) + ' محافظة مضبوطة' : 'مفيش محافظات',
      },
      {
        key: 'whatsapp',
        label: 'رقم واتساب',
        ok: /^[0-9]{10,15}$/.test(whatsapp),
        state: /^[0-9]{10,15}$/.test(whatsapp) ? 'ok' : 'warn',
        detail: whatsapp !== '' ? whatsapp : 'مفيش رقم واتساب',
      },
    ]

    return {
      notifyEmail,
      notifyDelivery: {
        state: notifyState,
        windowHours: NOTIFY_WINDOW_HOURS,
        recentOrders,
        failedOrders,
        countsExact,
      },
      readiness,
    }
  },
}
