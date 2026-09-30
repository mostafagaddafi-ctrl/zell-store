import 'server-only'

import type {
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
  settingsMap,
  toAdminImage,
  toAdminLogo,
  toAdminOrder,
  toAdminOrderItem,
  toAdminProduct,
  type OrderItemRow,
  type OrderRow,
  type ProductImageRow,
  type ProductRow,
  type SettingRow,
  type SiteImageRow,
} from './rows'

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
  'subtotal_piastres',
  'shipping_piastres',
  'total_piastres',
  'notified_at',
  'notify_error',
  'created_at',
].join(',')

const CONTENT_KEYS = ['hero', 'order_steps', 'faqs', 'sections', 'footer_links', 'trust_line'] as const
const SHIPPING_KEYS = ['shipping_rates', 'shipping_default_piastres', 'free_shipping_threshold_piastres'] as const
const IDENTITY_KEYS = ['store_name', 'logo_url', 'offer_text', 'whatsapp_number', 'whatsapp_message'] as const
const OPERATIONAL_KEYS = ['notify_email', 'telegram_bot_token', 'whatsapp_number'] as const

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
      // مفيش عمود internal_notes في الداتابيز لسه — migration منفصلة
      internalNotes: null,
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

    return {
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
    const rows = await restGet<SettingRow>('settings', 'select=key,value&key=' + inFilter(SHIPPING_KEYS))
    const map = settingsMap(rows.rows)

    return {
      rates: readRates(map, 'shipping_rates'),
      defaultPiastres: readNumber(map, 'shipping_default_piastres'),
      freeThresholdPiastres: readNumber(map, 'free_shipping_threshold_piastres'),
      // مفيش مفتاح shipping_disabled_governorates لسه — migration منفصلة
      disabled: [],
    }
  },

  async getIdentity(): Promise<StoreIdentity> {
    const [rows, logos] = await Promise.all([
      restGet<SettingRow>('settings', 'select=key,value&key=' + inFilter(IDENTITY_KEYS)),
      restGet<SiteImageRow>(
        'site_images',
        'select=id,bucket,object_path,alt_text,width_px,height_px,updated_at&kind=eq.logo&is_active=eq.true&order=id.desc&limit=1',
      ),
    ])

    const map = settingsMap(rows.rows)
    const storeName = readString(map, 'store_name', 'ZELL')
    const logoRow = logos.rows[0]

    return {
      storeName,
      logo: logoRow ? toAdminLogo(logoRow, projectUrl(), storeName) : null,
      offerText: readString(map, 'offer_text'),
      whatsappNumber: readString(map, 'whatsapp_number'),
      whatsappMessage: readString(map, 'whatsapp_message'),
    }
  },

  async getOperationalSettings(): Promise<OperationalSettings> {
    const [rows, products, images, shipping] = await Promise.all([
      restGet<SettingRow>('settings', 'select=key,value&key=' + inFilter(OPERATIONAL_KEYS)),
      restGet<{ id: number; is_active: boolean }>('products', 'select=id,is_active&order=id.asc'),
      restGet<{ product_id: number }>('product_images', 'select=product_id&kind=eq.gallery'),
      restGet<SettingRow>('settings', 'select=key,value&key=' + inFilter(SHIPPING_KEYS)),
    ])

    const map = settingsMap(rows.rows)
    const notifyEmail = readString(map, 'notify_email')
    const whatsapp = readString(map, 'whatsapp_number')

    /**
     * التوكن بيتقرا على السيرفر بس ويتحول لـ boolean فورًا.
     * القيمة نفسها ما بتخرجش من الدالة دي أبدًا.
     */
    const telegramConfigured = readString(map, 'telegram_bot_token').trim() !== ''

    const shippingMap = settingsMap(shipping.rows)
    const governorates = Object.keys(readRates(shippingMap, 'shipping_rates')).length
    const shippingDefault = readNumber(shippingMap, 'shipping_default_piastres')

    const withImages = new Set(images.rows.map((image) => image.product_id))
    const active = products.rows.filter((row) => row.is_active)
    const activeWithoutImages = active.filter((row) => !withImages.has(row.id)).length

    const readiness: ReadinessCheck[] = [
      {
        key: 'notifications',
        label: 'إشعارات الطلبات',
        ok: notifyEmail !== '',
        detail: notifyEmail !== '' ? 'الإشعارات بتروح على ' + notifyEmail : 'مفيش إيميل إشعارات متظبط',
      },
      { key: 'orders_api', label: 'استقبال الطلبات', ok: false, detail: 'إنشاء الطلب لسه معطّل في المتجر' },
      {
        key: 'products',
        label: 'المنتجات النشطة',
        ok: active.length > 0,
        detail: active.length > 0 ? String(active.length) + ' منتج نشط' : 'مفيش منتجات نشطة',
      },
      {
        key: 'images',
        label: 'صور المنتجات',
        ok: active.length > 0 && activeWithoutImages === 0,
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
        detail: governorates > 0 ? String(governorates) + ' محافظة مضبوطة' : 'مفيش محافظات',
      },
      {
        key: 'whatsapp',
        label: 'رقم واتساب',
        ok: /^[0-9]{10,15}$/.test(whatsapp),
        detail: whatsapp !== '' ? whatsapp : 'مفيش رقم واتساب',
      },
    ]

    return { notifyEmail, telegramConfigured, readiness }
  },
}
