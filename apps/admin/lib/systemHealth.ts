import 'server-only'

import { restGet } from './data/client'
import type { MutationResult } from './mutations'

/**
 * «حالة النظام» — كل مؤشر هنا **فحص حقيقي** مش كلام مكتوب.
 *
 *   اللوحة  -> متغيرات بيئتها (موجود/ناقص) + قراءة فعلية من الداتابيز
 *   المتجر  -> /api/health في المتجر بـ REVALIDATE_SECRET (مشروع Vercel منفصل،
 *              فاللوحة مستحيل تقرا متغيراته مباشرة)
 *   السجل   -> من الداتابيز: آخر فشل إشعار، الملفات المستنية تنظيف، آخر طلب
 *
 * 🔒 ولا قيمة سرية بتتقرا للعرض — موجود/ناقص بس.
 */

export type HealthState = 'ok' | 'warn' | 'error' | 'unknown'
export type HealthItem = { key: string; label: string; state: HealthState; detail: string }
export type NotifyFailure = { orderNumber: string; error: string; createdAt: string }

export type SystemHealth = {
  storefront: HealthItem[]
  admin: HealthItem[]
  deployment: { commit: string | null; environment: string | null } | null
  notifyFailures: NotifyFailure[]
  pendingOrphans: number | null
  lastOrderAt: string | null
  checkedAt: string
}

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

function presence(name: string, purpose: string): HealthItem {
  const ok = env(name) !== ''
  return { key: name, label: name, state: ok ? 'ok' : 'error', detail: ok ? 'موجود · ' + purpose : 'ناقص في إعدادات Vercel للوحة — ' + purpose }
}

/** نفس شروط revalidateStorefront: https · نفس STOREFRONT_HOST · مفيش مسار. */
function storefrontEndpoint(path: string): string | null {
  const raw = env('STOREFRONT_URL')
  const allowedHost = env('STOREFRONT_HOST').toLowerCase()
  if (raw === '' || allowedHost === '') return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
  if (url.search !== '' || url.hash !== '') return null
  if (url.pathname !== '' && url.pathname !== '/') return null
  if (url.host.toLowerCase() !== allowedHost) return null
  return url.origin + path
}

type CallResult = { ok: true; data: Record<string, unknown> } | { ok: false; reason: string }

async function callStorefront(method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<CallResult> {
  const endpoint = storefrontEndpoint('/api/health')
  const secret = env('REVALIDATE_SECRET')
  if (endpoint === null) return { ok: false, reason: 'STOREFRONT_URL أو STOREFRONT_HOST ناقص أو مش متطابق في إعدادات اللوحة' }
  if (secret === '') return { ok: false, reason: 'REVALIDATE_SECRET ناقص في إعدادات اللوحة' }

  try {
    const headers: Record<string, string> = { 'x-revalidate-secret': secret }
    if (body) headers['Content-Type'] = 'application/json'
    const response = await fetch(endpoint, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 401) return { ok: false, reason: 'المتجر رفض المفتاح — REVALIDATE_SECRET مختلف بين المتجر واللوحة' }
    if (response.status === 404) return { ok: false, reason: 'صفحة الفحص مش موجودة في المتجر — المتجر محتاج نشرة جديدة' }
    if (!response.ok) return { ok: false, reason: 'المتجر ردّ ' + String(response.status) }
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) return { ok: false, reason: 'رد المتجر مش مفهوم' }
    return { ok: true, data: payload as Record<string, unknown> }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.name === 'TimeoutError' ? 'المتجر مارَدّش في ١٠ ثواني' : 'مش قادرين نوصل للمتجر',
    }
  }
}

function storefrontItems(result: CallResult): HealthItem[] {
  if (!result.ok) {
    return [{ key: 'reach', label: 'الاتصال بالمتجر', state: 'error', detail: result.reason }]
  }
  const data = result.data
  const present = (typeof data['present'] === 'object' && data['present'] !== null ? data['present'] : {}) as Record<string, unknown>
  const database = (typeof data['database'] === 'object' && data['database'] !== null ? data['database'] : {}) as Record<string, unknown>
  const has = (name: string) => present[name] === true
  const source = typeof data['dataSource'] === 'string' ? data['dataSource'] : null

  return [
    { key: 'reach', label: 'الاتصال بالمتجر', state: 'ok', detail: 'المتجر رد والمفتاح متطابق' },
    data['ordersEnabled'] === true
      ? { key: 'orders', label: 'استقبال الطلبات', state: 'ok', detail: 'شغّال — الزباين يقدروا يطلبوا (ORDERS_ENABLED)' }
      : { key: 'orders', label: 'استقبال الطلبات', state: 'warn', detail: 'متوقف — ORDERS_ENABLED مش true في إعدادات المتجر' },
    source === 'supabase'
      ? { key: 'source', label: 'مصدر البيانات', state: 'ok', detail: 'الداتابيز الحقيقية (STOREFRONT_DATA_SOURCE)' }
      : { key: 'source', label: 'مصدر البيانات', state: 'error', detail: source === 'fallback' ? 'المتجر بيعرض بيانات تجريبية — STOREFRONT_DATA_SOURCE = fallback' : 'STOREFRONT_DATA_SOURCE ناقص' },
    database['ok'] === true
      ? { key: 'db', label: 'قراءة الداتابيز من المتجر', state: 'ok', detail: 'اتجربت دلوقتي ونجحت' }
      : { key: 'db', label: 'قراءة الداتابيز من المتجر', state: 'error', detail: typeof database['detail'] === 'string' ? database['detail'] : 'فشلت' },
    has('SUPABASE_READ_KEY')
      ? { key: 'readkey', label: 'مفتاح القراءة', state: 'ok', detail: 'SUPABASE_READ_KEY موجود' }
      : { key: 'readkey', label: 'مفتاح القراءة', state: has('SUPABASE_SERVICE_ROLE_KEY') ? 'warn' : 'error', detail: has('SUPABASE_SERVICE_ROLE_KEY') ? 'بيستخدم مفتاح الخدمة مؤقتًا — شغّال، بس الأأمن مفتاح قراءة محدود' : 'مفيش مفتاح قراءة' },
    has('TELEGRAM_BOT_TOKEN') && has('TELEGRAM_CHAT_ID')
      ? { key: 'telegram', label: 'إعداد تليجرام', state: 'ok', detail: 'التوكن ورقم الشات موجودين — اختبره بالزرار تحت' }
      : { key: 'telegram', label: 'إعداد تليجرام', state: 'error', detail: (has('TELEGRAM_BOT_TOKEN') ? '' : 'TELEGRAM_BOT_TOKEN ') + (has('TELEGRAM_CHAT_ID') ? '' : 'TELEGRAM_CHAT_ID ') + 'ناقص في إعدادات المتجر' },
  ]
}

async function adminItems(): Promise<HealthItem[]> {
  let database: HealthItem
  try {
    await restGet<{ id: number }>('products', 'select=id&limit=1')
    database = { key: 'db', label: 'قراءة الداتابيز من اللوحة', state: 'ok', detail: 'اتجربت دلوقتي ونجحت' }
  } catch {
    database = { key: 'db', label: 'قراءة الداتابيز من اللوحة', state: 'error', detail: 'فشلت — راجع SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY' }
  }
  const mutations = env('ADMIN_MUTATIONS_ENABLED') === 'true'
  return [
    database,
    { key: 'mutations', label: 'التعديلات من اللوحة', state: mutations ? 'ok' : 'warn', detail: mutations ? 'مفتوحة (ADMIN_MUTATIONS_ENABLED)' : 'مقفولة — ADMIN_MUTATIONS_ENABLED مش true' },
    presence('SUPABASE_URL', 'عنوان الداتابيز'),
    presence('SUPABASE_SERVICE_ROLE_KEY', 'قراءة وكتابة اللوحة'),
    presence('SUPABASE_ANON_KEY', 'تسجيل الدخول'),
    presence('STOREFRONT_URL', 'التحديث الفوري وفحص المتجر'),
    presence('STOREFRONT_HOST', 'حماية رابط المتجر'),
    presence('REVALIDATE_SECRET', 'التحديث الفوري وفحص المتجر'),
  ]
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [store, admin, failures, orphans, lastOrder] = await Promise.all([
    callStorefront('GET'),
    adminItems(),
    restGet<{ order_number: string; notify_error: string; created_at: string }>(
      'orders',
      'select=order_number,notify_error,created_at&notify_error=not.is.null&order=created_at.desc&limit=5',
    ).catch(() => null),
    restGet<{ id: number }>('storage_orphans', 'select=id&cleaned_at=is.null&limit=1', { exactCount: true }).catch(() => null),
    restGet<{ created_at: string }>('orders', 'select=created_at&order=created_at.desc&limit=1').catch(() => null),
  ])

  const deploymentRaw = store.ok && typeof store.data['deployment'] === 'object' && store.data['deployment'] !== null
    ? (store.data['deployment'] as Record<string, unknown>)
    : null

  return {
    storefront: storefrontItems(store),
    admin,
    deployment: deploymentRaw
      ? {
          commit: typeof deploymentRaw['commit'] === 'string' ? deploymentRaw['commit'] : null,
          environment: typeof deploymentRaw['environment'] === 'string' ? deploymentRaw['environment'] : null,
        }
      : null,
    notifyFailures: failures
      ? failures.rows.map((row) => ({ orderNumber: row.order_number, error: row.notify_error, createdAt: row.created_at }))
      : [],
    pendingOrphans: orphans ? orphans.total : null,
    lastOrderAt: lastOrder ? (lastOrder.rows[0]?.created_at ?? null) : null,
    checkedAt: new Date().toISOString(),
  }
}

const TELEGRAM_MESSAGES: Record<string, string> = {
  TELEGRAM_NOT_CONFIGURED: 'التوكن أو رقم الشات ناقص في إعدادات المتجر على Vercel',
  TELEGRAM_HTTP_401: 'توكن البوت غلط (TELEGRAM_BOT_TOKEN)',
  TELEGRAM_HTTP_400: 'رقم الشات غلط، أو البوت مش متضاف للجروب (TELEGRAM_CHAT_ID)',
  TELEGRAM_HTTP_403: 'البوت متشال من الجروب أو محظور',
  TELEGRAM_HTTP_404: 'توكن البوت غلط (TELEGRAM_BOT_TOKEN)',
  TELEGRAM_TIMEOUT: 'تليجرام مارَدّش في الوقت — جرّب تاني',
  TELEGRAM_FETCH_FAILED: 'المتجر مش قادر يوصل لتليجرام — جرّب تاني',
}

/** رسالة تجربة حقيقية عن طريق المتجر — نفس طريق إشعار الطلبات بالظبط. */
export async function testTelegram(): Promise<MutationResult<{ delivered: true }>> {
  const result = await callStorefront('POST', { action: 'test-telegram' })
  if (!result.ok) return { ok: false, code: 'INTERNAL', message: result.reason }
  if (result.data['ok'] === true) return { ok: true, data: { delivered: true } }
  const code = typeof result.data['code'] === 'string' ? result.data['code'] : ''
  return { ok: false, code: 'INTERNAL', message: TELEGRAM_MESSAGES[code] ?? 'تليجرام رفض الرسالة (' + code + ')' }
}
