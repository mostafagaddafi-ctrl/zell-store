/**
 * IMAGE-DELETE (C1، معالجة B2) — حالات المسارات الفعلية بشبكة مزيّفة (من غير داتابيز ولا Supabase حقيقي).
 *
 * بتشغّل كود السيرفر نفسه: uploadProductImage (lib/mutations/imageUpload.ts) و saveProduct / setProductVisibility
 * (lib/mutations/products.ts) و supabaseAdminData.getProduct (lib/data/reads.ts)، وهم بيكلّموا lib/data/client.ts الحقيقي.
 * الشبكة بس هي المزيّفة: fetch عام بيحاكي PostgREST (الفلاتر · id::text · ردود الأخطاء بنفس الشكل) وStorage، على حالة في الذاكرة.
 * server-only بيتبدّل بملف فاضي في مشغّل الحالات (scripts/run-cases.mjs · stub)، ومتغيرات البيئة وfetch بيرجعوا بعد كل حالة.
 * العقد: docs/contracts/IMAGE-DELETE.md §٣ و§٥-ج و§٥-د.
 */

import { supabaseAdminData } from '../data/reads'
import { toAdminImage } from '../data/rows'
import { uploadProductImage } from '../mutations/imageUpload'
import { saveProduct, setProductVisibility } from '../mutations/products'
import { INSERT_UNCONFIRMED_MESSAGE, PRIMARY_CLEANUP_INCOMPLETE_MESSAGE, PRIMARY_UPLOAD_CANCELLED_MESSAGE } from './uploadRollback'

export type FlowCaseFailure = { name: string; expected: string; actual: string }

const failures: FlowCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

// ── حالة الداتابيز والتخزين المزيّفة ────────────────────────────────

type Img = {
  id: string
  product_id: number
  bucket: string
  object_path: string
  kind: string
  alt_text: string | null
  fit: string
  sort_order: number
  is_primary: boolean
  width_px: number | null
  height_px: number | null
  checksum: string | null
  updated_at: string
}

type Prod = {
  id: number
  name_ar: string
  name_en: string | null
  brand: string | null
  description_ar: string | null
  short_benefit: string | null
  benefits: string[]
  price_per_meter_piastres: number
  width_cm: number
  lock_width: boolean
  compare_at_piastres: number | null
  sale_unit: string
  is_listed: boolean
  max_quantity: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
  is_active: boolean
  sort_order: number
  updated_at: string
}

type World = {
  products: Prod[]
  images: Img[]
  files: Set<string>
  orphans: Array<{ bucket: string; object_path: string; reason: string }>
  nextId: string
  log: string[]
  /** بعد ما الإدخال يتعمل له commit وقبل الرد. */
  afterInsert?: (row: Img) => void
  insertReply?: 'ok' | 'lost'
  setPrimaryReply?: 'ok' | 'lost' | 'fail-before-commit'
  /** قبل تنفيذ PATCH على products (بعد فحص الجاهزية في الكود). */
  beforeProductPatch?: () => void
}

const AT = '2026-11-07T10:00:00.000Z'
const BUCKET = 'product-images'
const BIG_A = '9007199254740992'
const BIG_B = '9007199254740993'

function product(patch: Partial<Prod> = {}): Prod {
  return {
    id: 7,
    name_ar: 'ستارة',
    name_en: null,
    brand: null,
    description_ar: 'وصف',
    short_benefit: 'فايدة',
    benefits: [],
    price_per_meter_piastres: 10000,
    width_cm: 280,
    lock_width: false,
    compare_at_piastres: null,
    sale_unit: 'meter',
    is_listed: true,
    max_quantity: 20,
    min_length_cm: 100,
    step_cm: 10,
    max_length_cm: 600,
    is_active: false,
    sort_order: 1,
    updated_at: AT,
    ...patch,
  }
}

function image(id: string, patch: Partial<Img> = {}): Img {
  return {
    id,
    product_id: 7,
    bucket: BUCKET,
    object_path: 'products/7/old-' + id + '.webp',
    kind: 'gallery',
    alt_text: null,
    fit: 'contain',
    sort_order: 0,
    is_primary: false,
    width_px: 10,
    height_px: 10,
    checksum: null,
    updated_at: AT,
    ...patch,
  }
}

function world(patch: Partial<World>): World {
  const w: World = { products: [product()], images: [], files: new Set<string>(), orphans: [], nextId: '205', log: [], ...patch }
  for (const img of w.images) w.files.add(img.object_path)
  return w
}

/** الـ ids مخزّنة نصوص. في الرد: نص لو الـ select فيه id::text، وإلا رقم JSON خام (زي PostgREST مع bigint). */
function rowsText(rows: Array<Record<string, unknown>>, idAsText: boolean): string {
  const marked = rows.map((row) => (typeof row['id'] === 'string' ? { ...row, id: '__ID__' + String(row['id']) } : row))
  return JSON.stringify(marked).replace(/"__ID__([0-9]+)"/g, (_m: string, digits: string) => (idAsText ? '"' + digits + '"' : digits))
}

function project(row: Record<string, unknown>, select: string | null): Record<string, unknown> {
  if (select === null || select === '*') return { ...row }
  const out: Record<string, unknown> = {}
  for (const raw of select.split(',')) {
    const name = raw.replace('::text', '')
    out[name] = name in row ? row[name] : null
  }
  return out
}

function matches(row: Record<string, unknown>, params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (key === 'select' || key === 'order' || key === 'limit') continue
    const cell = row[key]
    if (value.startsWith('eq.')) {
      if (String(cell) !== value.slice(3)) return false
    } else if (value === 'is.true') {
      if (cell !== true) return false
    } else if (value === 'is.false') {
      if (cell !== false) return false
    } else {
      throw new Error('filter not faked: ' + key + '=' + value)
    }
  }
  return true
}

function sortRows<T extends Record<string, unknown>>(rows: T[], order: string | null): T[] {
  if (order === null) return rows
  const parts = order.split(',').map((p) => p.split('.'))
  return [...rows].sort((a, b) => {
    for (const [col, dir] of parts) {
      if (col === undefined) continue
      const x = a[col]
      const y = b[col]
      let cmp = 0
      if (col === 'id') cmp = BigInt(String(x)) < BigInt(String(y)) ? -1 : BigInt(String(x)) > BigInt(String(y)) ? 1 : 0
      else if (typeof x === 'boolean' && typeof y === 'boolean') cmp = Number(x) - Number(y)
      else cmp = Number(x) - Number(y)
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

function reply(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, statusText: status < 300 ? 'OK' : 'Bad Request', headers: { 'content-type': 'application/json', ...headers } })
}

function postgrestError(code: string, message: string): Response {
  return reply(400, JSON.stringify({ code, details: null, hint: null, message }))
}

function bodyJson(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
}

function fakeFetch(w: World) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const params = url.searchParams
    w.log.push(method + ' ' + url.pathname + (url.search === '' ? '' : '?' + decodeURIComponent(url.search.slice(1))))
    const select = params.get('select')
    const idAsText = (select ?? '').split(',').includes('id::text')
    const limit = params.get('limit')

    if (url.pathname.startsWith('/storage/v1/object/' + BUCKET + '/')) {
      const path = url.pathname.slice(('/storage/v1/object/' + BUCKET + '/').length).split('/').map(decodeURIComponent).join('/')
      if (method === 'POST') w.files.add(path)
      else if (method === 'DELETE') w.files.delete(path)
      return reply(200, '{}')
    }

    if (url.pathname === '/rest/v1/products') {
      const found = w.products.filter((p) => matches(p as unknown as Record<string, unknown>, params))
      if (method === 'GET') {
        const rows = found.slice(0, limit === null ? undefined : Number(limit)).map((p) => project(p as unknown as Record<string, unknown>, select))
        return reply(200, JSON.stringify(rows))
      }
      if (method === 'PATCH') {
        w.beforeProductPatch?.()
        const changes = bodyJson(init)
        for (const p of found) {
          // trigger 0026 zell_catalog_products_activation_guard: الانتقال لظاهر من غير رئيسية من المعرض = 45705
          const hasPrimary = w.images.some((i) => i.product_id === p.id && i.kind === 'gallery' && i.is_primary)
          if (changes['is_active'] === true && !p.is_active && !hasPrimary) return postgrestError('45705', 'ZELL_PRODUCT_NEEDS_PRIMARY_IMAGE')
        }
        for (const p of found) Object.assign(p, changes)
        return reply(200, JSON.stringify(found.map((p) => project(p as unknown as Record<string, unknown>, select))))
      }
    }

    if (url.pathname === '/rest/v1/product_images') {
      if (method === 'GET') {
        const all = sortRows(w.images.filter((i) => matches(i as unknown as Record<string, unknown>, params)), params.get('order'))
        const rows = all.slice(0, limit === null ? undefined : Number(limit)).map((i) => project(i as unknown as Record<string, unknown>, select))
        const headers: Record<string, string> = {}
        if (new Headers(init?.headers).get('Prefer') === 'count=exact') headers['content-range'] = '0-' + String(rows.length - 1) + '/' + String(all.length)
        return reply(200, rowsText(rows, idAsText), headers)
      }
      if (method === 'POST') {
        const b = bodyJson(init)
        const row = image(w.nextId, {
          product_id: Number(b['product_id']),
          object_path: String(b['object_path']),
          kind: String(b['kind']),
          sort_order: Number(b['sort_order']),
          is_primary: b['is_primary'] === true,
          fit: String(b['fit']),
          checksum: String(b['checksum']),
        })
        w.nextId = String(BigInt(w.nextId) + 1n)
        w.images.push(row)
        w.afterInsert?.(row)
        if (w.insertReply === 'lost') throw new TypeError('fetch failed')
        return reply(201, rowsText([project(row as unknown as Record<string, unknown>, select)], idAsText))
      }
      if (method === 'DELETE') {
        const removed = w.images.filter((i) => matches(i as unknown as Record<string, unknown>, params))
        w.images = w.images.filter((i) => !removed.includes(i))
        return reply(200, rowsText(removed as unknown as Array<Record<string, unknown>>, false))
      }
    }

    if (url.pathname === '/rest/v1/rpc/zell_set_primary_product_image' && method === 'POST') {
      if (w.setPrimaryReply === 'fail-before-commit') return reply(500, JSON.stringify({ code: 'XX000', details: null, hint: null, message: 'boom' }))
      const b = bodyJson(init)
      const target = w.images.find((i) => i.product_id === b['p_product_id'] && i.id === b['p_image_id'])
      if (target === undefined) return reply(200, 'null')
      for (const i of w.images) {
        if (i.product_id !== target.product_id) continue
        i.is_primary = i === target
        i.fit = i === target ? 'cover' : 'contain'
      }
      if (w.setPrimaryReply === 'lost') throw new TypeError('fetch failed')
      return reply(200, JSON.stringify(AT))
    }

    if (url.pathname === '/rest/v1/storage_orphans' && method === 'POST') {
      const b = bodyJson(init)
      const row = { bucket: String(b['bucket']), object_path: String(b['object_path']), reason: String(b['reason']) }
      w.orphans.push(row)
      return reply(201, JSON.stringify([row]))
    }

    w.log.push('UNHANDLED')
    return reply(500, '{}')
  }
}

async function inWorld<T>(w: World, fn: () => Promise<T>): Promise<T> {
  const savedFetch = globalThis.fetch
  const savedUrl = process.env['SUPABASE_URL']
  const savedKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  globalThis.fetch = fakeFetch(w) as typeof fetch
  process.env['SUPABASE_URL'] = 'https://zell.test'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-key'
  try {
    return await fn()
  } finally {
    globalThis.fetch = savedFetch
    if (savedUrl === undefined) delete process.env['SUPABASE_URL']
    else process.env['SUPABASE_URL'] = savedUrl
    if (savedKey === undefined) delete process.env['SUPABASE_SERVICE_ROLE_KEY']
    else process.env['SUPABASE_SERVICE_ROLE_KEY'] = savedKey
  }
}

/** PNG حقيقي 1×1 (detectImage وimage-size بيقروه). */
function png(): Uint8Array<ArrayBuffer> {
  const raw = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function upload(w: World) {
  return inWorld(w, () => uploadProductImage({ productId: 7, kind: 'gallery', altText: '', bytes: png() }))
}

const writes = (w: World) => w.log.filter((l) => !l.startsWith('GET '))
const newPath = (w: World) => w.images.find((i) => i.object_path.startsWith('products/7/') && !i.object_path.includes('/old-'))?.object_path ?? null
const uploadedFiles = (w: World) => [...w.files].filter((f) => !f.includes('/old-'))

export async function runImageFlowCases(): Promise<{ passed: number; failures: FlowCaseFailure[] }> {
  // ── §٥-د: إدخال ملتزم ورد ضايع، والمالك بيحذف الرئيسية P فدالة 0026 بترقّي X، والرفع بيكمّل ──────
  {
    const w = world({ products: [product({ is_active: true })], images: [image('101', { is_primary: true, fit: 'cover' })], insertReply: 'lost' })
    w.afterInsert = (x) => {
      // نفس أثر zell_product_image_delete على P: تسجيل الملف removed · مسح الصف · ترقية أول صورة معرض باقية (X)
      const p = w.images.find((i) => i.id === '101')
      if (p === undefined) return
      w.orphans.push({ bucket: p.bucket, object_path: p.object_path, reason: 'removed' })
      w.images = w.images.filter((i) => i !== p)
      x.is_primary = true
      x.fit = 'cover'
    }
    const out = await upload(w)
    const xPath = newPath(w)
    check('F01 committed insert + lost reply + X promoted by the delete function: upload never deletes a row or a file', {
      status: out.status,
      result: out.result,
      writes: writes(w).map((l) => l.split('?')[0]),
      xRow: w.images.map((i) => ({ id: i.id, primary: i.is_primary, fit: i.fit })),
      xFileKept: xPath !== null && w.files.has(xPath),
      orphans: w.orphans.map((o) => o.reason + ':' + (o.object_path === xPath ? 'X' : 'P')),
    }, {
      status: 500,
      result: { ok: false, code: 'INTERNAL', message: INSERT_UNCONFIRMED_MESSAGE },
      writes: ['POST /storage/v1/object/product-images/products/7/' + (xPath ?? '').slice('products/7/'.length), 'POST /rest/v1/product_images', 'POST /rest/v1/storage_orphans'],
      xRow: [{ id: '205', primary: true, fit: 'cover' }],
      xFileKept: true,
      orphans: ['removed:P', 'insert_failed:X'],
    })
  }

  // ── §٥-ج: تعيين رئيسية ملتزم ورد فاشل، والحذف المشروط بيمسح صفر، من غير مسح ملف ──────
  {
    const w = world({ images: [], setPrimaryReply: 'lost' })
    const out = await upload(w)
    const xPath = newPath(w)
    check('F02 committed set-primary + failed reply: conditional delete removes 0 rows, file untouched, nothing recorded', {
      result: out.result,
      deletes: w.log.filter((l) => l.startsWith('DELETE ')),
      rows: w.images.map((i) => ({ id: i.id, primary: i.is_primary })),
      fileKept: xPath !== null && w.files.has(xPath),
      orphans: w.orphans.length,
    }, {
      result: { ok: false, code: 'INTERNAL', message: PRIMARY_CLEANUP_INCOMPLETE_MESSAGE },
      deletes: ['DELETE /rest/v1/product_images?id=eq.205&is_primary=is.false'],
      rows: [{ id: '205', primary: true }],
      fileKept: true,
      orphans: 0,
    })
  }
  {
    const w = world({ images: [], setPrimaryReply: 'fail-before-commit' })
    const out = await upload(w)
    check('F03 set-primary really failed (no commit): the row is deleted by the conditional delete, then its file', {
      result: out.result,
      deletes: w.log.filter((l) => l.startsWith('DELETE ')).map((l) => l.replace(/[0-9a-f-]{36}/, 'UUID')),
      rows: w.images.length,
      files: uploadedFiles(w).length,
    }, {
      result: { ok: false, code: 'INTERNAL', message: PRIMARY_UPLOAD_CANCELLED_MESSAGE },
      deletes: ['DELETE /rest/v1/product_images?id=eq.205&is_primary=is.false', 'DELETE /storage/v1/object/product-images/products/7/UUID.png'],
      rows: 0,
      files: 0,
    })
  }
  {
    const w = world({ images: [] })
    const out = await upload(w)
    check('F04 normal upload: set-primary ok, re-read asks id::text, result = stored primary with the exact id', {
      ok: out.result.ok,
      id: out.result.ok ? out.result.data.id : null,
      primary: out.result.ok ? out.result.data.isPrimary : null,
      reread: w.log.filter((l) => l.startsWith('GET /rest/v1/product_images?select=id::text')).length,
    }, { ok: true, id: '205', primary: true, reread: 1 })
  }

  // ── B1: معرّفين bigint متجاورين برّه المدى الآمن ──────────────────────────
  {
    // المنتج فيه صورة A (مش رئيسية)، والصورة الجديدة هتاخد B. رد الإدخال رقم JSON خام، فبيتقرّب لـ A.
    const w = world({ images: [image(BIG_A)], nextId: BIG_B })
    const out = await upload(w)
    check('F05 inserted id B arrives rounded (= neighbour A): treated as unconfirmed; no set-primary, no delete, nothing sent with A', {
      result: out.result,
      writes: writes(w).map((l) => l.split('?')[0]),
      rows: w.images.map((i) => i.id),
      newFileKept: uploadedFiles(w).length,
      sentA: w.log.some((l) => !l.startsWith('GET ') && l.includes(BIG_A)),
    }, {
      result: { ok: false, code: 'INTERNAL', message: INSERT_UNCONFIRMED_MESSAGE },
      writes: ['POST /storage/v1/object/product-images/products/7/' + (uploadedFiles(w)[0] ?? '').slice('products/7/'.length), 'POST /rest/v1/product_images', 'POST /rest/v1/storage_orphans'],
      rows: [BIG_A, BIG_B],
      newFileKept: 1,
      sentA: false,
    })
  }
  {
    const w = world({ images: [image(BIG_A, { sort_order: 0 }), image(BIG_B, { sort_order: 1, is_primary: true, fit: 'cover' })] })
    const detail = await inWorld(w, () => supabaseAdminData.getProduct(7))
    check('F06 product read asks id::text: both neighbour ids arrive exact and distinct', {
      ids: detail === null ? null : detail.images.map((i) => i.id),
      query: w.log.filter((l) => l.startsWith('GET /rest/v1/product_images?select=id::text,')).length,
    }, { ids: [BIG_B, BIG_A], query: 1 })
  }
  check('F07 a product image row with a rounded numeric id is refused, not shown under a neighbour id', (() => {
    const row = { ...image(BIG_A), id: JSON.parse(BIG_B) as number }
    try {
      toAdminImage(row, 'https://zell.test', 'x')
      return 'shown'
    } catch {
      return 'refused'
    }
  })(), 'refused')

  // ── 45705 بخطأ PostgREST الحقيقي الشكل في الحفظ والإظهار ───────────────────
  const ACTIVATION_MESSAGE = 'ماينفعش تفعّل المنتج قبل ما تكمّل: صورة رئيسية من المعرض.'
  {
    const w = world({ images: [image('101', { is_primary: true, fit: 'cover' })] })
    // فحص الجاهزية شاف الرئيسية، وبعده اتحذفت قبل الـ PATCH، فالـ trigger رفض
    w.beforeProductPatch = () => {
      w.images = []
    }
    const res = await inWorld(w, () => setProductVisibility(7, true, AT))
    check('P01 setProductVisibility: PostgREST 45705 (ZELL_PRODUCT_NEEDS_PRIMARY_IMAGE) -> activation validation message', {
      res,
      patched: w.log.filter((l) => l.startsWith('PATCH /rest/v1/products')).length,
      active: w.products[0]?.is_active,
    }, { res: { ok: false, code: 'VALIDATION', message: ACTIVATION_MESSAGE }, patched: 1, active: false })
  }
  {
    const w = world({ images: [image('101', { is_primary: true, fit: 'cover' })] })
    w.beforeProductPatch = () => {
      w.images = []
    }
    const res = await inWorld(w, () =>
      saveProduct({
        id: 7,
        expectedUpdatedAt: AT,
        nameAr: 'ستارة',
        descriptionAr: 'وصف',
        shortBenefit: 'فايدة',
        pricePerMeterPiastres: 10000,
        widthCm: 280,
        minLengthCm: 100,
        stepCm: 10,
        maxLengthCm: 600,
        sortOrder: 1,
        isActive: true,
      }),
    )
    check('P02 saveProduct (activating): PostgREST 45705 -> the same activation validation message', {
      res,
      patched: w.log.filter((l) => l.startsWith('PATCH /rest/v1/products')).length,
      active: w.products[0]?.is_active,
    }, { res: { ok: false, code: 'VALIDATION', message: ACTIVATION_MESSAGE }, patched: 1, active: false })
  }
  {
    const w = world({ images: [image('101', { is_primary: true, fit: 'cover' })] })
    const res = await inWorld(w, () => setProductVisibility(7, true, AT))
    check('P03 control: with the primary still there the guard passes and the product becomes visible', {
      ok: res.ok,
      active: w.products[0]?.is_active,
    }, { ok: true, active: true })
  }

  return { passed, failures }
}
