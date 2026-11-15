/**
 * PRODUCT-ISR §٢-٢ — مصدر HTTP صناعي بيقلّد ردود PostgREST للجداول الـ ٨ اللي بيقراها
 * lib/data/queries.ts (restGet). داتا ثابتة في الذاكرة، من غير أي مفتاح أو داتا أو رابط Production.
 *
 * • products بيحترم فلتر is_active=eq.true زي PostgREST، وباقي الجداول بترجع [].
 * • setFailing(true) = كل الطلبات بترجع 500 (فشل المصدر في T6).
 * • total() = عدّاد كل الطلبات اللي وصلت للمصدر (الدليل على إن إعادة الجلب اتحاولت أو لأ).
 */
import http from 'node:http'

export const TABLES = [
  'products',
  'product_images',
  'settings',
  'site_images',
  'collections',
  'product_collections',
  'product_widths',
  'product_addons',
]

/** منتج متر بعرض واحد ومن غير خصم ولا صور — سطر السعر بتاعه «السعر <جنيه> ج.م للمتر». */
export function syntheticProduct(id, pricePiastres) {
  return {
    id,
    name_ar: 'منتج اختبار ' + String(id),
    name_en: null,
    brand: null,
    description_ar: null,
    image_url: null,
    images: [],
    before_image: null,
    after_image: null,
    price_per_meter_piastres: pricePiastres,
    width_cm: 120,
    lock_width: false,
    compare_at_piastres: null,
    sale_unit: 'meter',
    is_listed: true,
    max_quantity: 20,
    min_length_cm: 100,
    step_cm: 10,
    max_length_cm: 3000,
    short_benefit: null,
    benefits: [],
    is_active: true,
  }
}

export function createSyntheticSource({ port, readKey }) {
  const products = new Map()
  const perTable = {}
  let failing = false
  let total = 0

  const server = http.createServer((req, res) => {
    total += 1
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const match = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)
    const table = match ? match[1] : '(other)'
    perTable[table] = (perTable[table] || 0) + 1

    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    if (failing) return send(500, { message: 'synthetic failure' })
    if (req.method !== 'GET' || !match || !TABLES.includes(table)) return send(404, { message: 'not found' })
    if (req.headers['apikey'] !== readKey) return send(401, { message: 'bad key' })
    if (table !== 'products') return send(200, [])

    let rows = [...products.values()]
    if (url.searchParams.get('is_active') === 'eq.true') rows = rows.filter((row) => row.is_active === true)
    rows.sort((a, b) => a.id - b.id)
    // is_active مش في الـ select بتاع الاستعلام، فمابيرجعش
    return send(
      200,
      rows.map(({ is_active: _active, ...row }) => row),
    )
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
    addProduct(id, pricePiastres) {
      products.set(id, syntheticProduct(id, pricePiastres))
    },
    updateProduct(id, patch) {
      const current = products.get(id)
      if (!current) throw new Error('synthetic source: no product ' + String(id))
      products.set(id, { ...current, ...patch })
    },
    setFailing(value) {
      failing = value
    },
    total: () => total,
    perTable: () => ({ ...perTable }),
  }
}
