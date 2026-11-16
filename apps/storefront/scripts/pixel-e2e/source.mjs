/**
 * META-PIXEL §٤-٣ — مصدر HTTP صناعي لاختبار المتصفح (storefront-pixel-e2e).
 * بيقلّد ردود PostgREST للجداول اللي بيقراها lib/data/queries.ts، ودوال RPC اللي الصفحات بتناديها.
 * داتا ثابتة في الذاكرة، من غير أي مفتاح أو داتا أو رابط Production.
 *
 * • settings.hero.metaPixelId بيتغيّر من الاختبار (setPixelId)، والتغيير بيوصل للمتجر بعد /api/revalidate.
 *   و productSizeEntry = 'm' (طريقة المتر) علشان «ضيف للسلة» في صفحة الفيلم يضيف بالطول الأدنى من غير خانات سم.
 * • zell_checkout_track_order بيرجّع طلب بقيم شخصية اختبارية مميزة (P08)، وباقي دوال RPC بترجع 404
 *   (المتجر بيعاملها كـ «الإعداد مش متاح»).
 */
import http from 'node:http'
import { syntheticProduct } from '../isr-integration/source.mjs'

export const METER_ID = 1
export const PIECE_ID = 2
export const COLLECTION_SLUG = 'test-collection'
export const GOVERNORATE = 'القاهرة'
/** لينك «المحتوى» في الفوتر (footer_links، next/link عادي) لمسار محجوب — P11 (د) و(و). */
export const CONTENT_TRACK_LABEL = 'تتبّع من المحتوى'
export const TRACK_ORDER_NUMBER = 'FLM-MRFVB3'
export const TRACK_CUSTOMER = {
  name: 'PRIVATE_TRACK_NAME',
  phone: '01198765432',
  address: 'PRIVATE_TRACK_ADDR شارع ٧',
  governorate: GOVERNORATE,
  area: 'PRIVATE_TRACK_AREA',
}

function products() {
  const meter = { ...syntheticProduct(METER_ID, 37100), name_ar: 'فيلم اختبار' }
  const piece = {
    ...syntheticProduct(PIECE_ID, 21700),
    name_ar: 'أداة اختبار',
    sale_unit: 'piece',
    max_quantity: 10,
  }
  return [meter, piece]
}

const COLLECTIONS = [
  {
    id: 1,
    slug: COLLECTION_SLUG,
    title_ar: 'قسم اختبار',
    subtitle_ar: null,
    show_on_home: true,
    show_in_nav: true,
    sort_order: 1,
    cover_bucket: null,
    cover_object_path: null,
    cover_width_px: null,
    cover_height_px: null,
    catalog_layout: null,
  },
]

const PRODUCT_COLLECTIONS = [{ collection_id: 1, product_id: METER_ID, sort_order: 1 }]
const PRODUCT_ADDONS = [{ product_id: METER_ID, addon_id: PIECE_ID, sort_order: 1 }]

function trackResponse() {
  return {
    order_number: TRACK_ORDER_NUMBER,
    status: 'confirmed',
    created_at: '2026-10-13T10:00:00+00:00',
    total_piastres: 26700,
    items: [
      { product_name_ar: 'أداة اختبار', length_cm: null, width_cm: null, quantity: 1, sale_unit: 'piece', line_total_piastres: 21700 },
    ],
    delivery: { kind: 'preferred', date: '2026-11-01', period: 'morning' },
    customer: { ...TRACK_CUSTOMER },
    history: [
      { status: 'new', at: '2026-10-13T10:00:00+00:00' },
      { status: 'confirmed', at: '2026-10-13T12:00:00+00:00' },
    ],
    money: {
      items_piastres: 21700,
      discount_piastres: 0,
      shipping_piastres: 5000,
      installation_piastres: 0,
      travel_piastres: 0,
      total_piastres: 26700,
      confirmation_fee_piastres: 0,
      paid_piastres: 0,
      refunded_piastres: 0,
      net_paid_piastres: 0,
      remaining_piastres: 26700,
    },
    shipping: { method: 'standard', days_min: 2, days_max: 5 },
    confirmed_delivery: null,
    shipment: null,
    updates: [],
  }
}

export function createPixelSource({ port, readKey, serviceKey }) {
  let pixelId = ''
  let total = 0
  const perPath = {}

  function settingsRows() {
    return [
      { key: 'store_name', value: 'myzill' },
      { key: 'hero', value: { metaPixelId: pixelId, productSizeEntry: 'm' } },
      { key: 'shipping_rates', value: { [GOVERNORATE]: 5000 } },
      { key: 'installation_tools_page', value: { enabled: true, title: 'أدوات التركيب' } },
      { key: 'footer_links', value: [{ label: CONTENT_TRACK_LABEL, href: '/track' }] },
    ]
  }

  const server = http.createServer((req, res) => {
    total += 1
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    perPath[url.pathname] = (perPath[url.pathname] || 0) + 1
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname)
    if (rpc) {
      if (req.method !== 'POST') return send(405, { message: 'method' })
      if (req.headers['apikey'] !== serviceKey) return send(401, { message: 'bad key' })
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        let args = {}
        try {
          args = JSON.parse(raw || '{}')
        } catch {
          args = {}
        }
        if (rpc[1] === 'zell_checkout_track_order') {
          return send(200, args.p_order_number === TRACK_ORDER_NUMBER ? trackResponse() : null)
        }
        return send(404, { message: 'synthetic: function not available' })
      })
      return undefined
    }

    const match = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)
    if (req.method !== 'GET' || !match) return send(404, { message: 'not found' })
    if (req.headers['apikey'] !== readKey) return send(401, { message: 'bad key' })
    switch (match[1]) {
      case 'products': {
        let rows = products()
        if (url.searchParams.get('is_active') === 'eq.true') rows = rows.filter((row) => row.is_active === true)
        return send(
          200,
          rows.map(({ is_active: _active, ...row }) => row),
        )
      }
      case 'settings':
        return send(200, settingsRows())
      case 'collections':
        return send(200, COLLECTIONS)
      case 'product_collections':
        return send(200, PRODUCT_COLLECTIONS)
      case 'product_addons':
        return send(200, PRODUCT_ADDONS)
      case 'product_images':
      case 'site_images':
      case 'product_widths':
        return send(200, [])
      default:
        return send(404, { message: 'not found' })
    }
  })

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => resolve())
      }),
    close: () =>
      new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
        server.close(() => resolve())
      }),
    setPixelId(value) {
      pixelId = value
    },
    pixelId: () => pixelId,
    total: () => total,
    count: (pathname) => perPath[pathname] || 0,
  }
}
