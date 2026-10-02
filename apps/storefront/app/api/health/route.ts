import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { sendTelegram } from '../../../lib/orders/notify'

/**
 * فحص حالة المتجر — **للوحة بس**، بنفس REVALIDATE_SECRET.
 *
 * GET  -> حالة الإعدادات (موجود/ناقص) + قراءة فعلية من الداتابيز + النسخة المنشورة.
 * POST { action: 'test-telegram' } -> رسالة تجربة حقيقية على تليجرام.
 *
 * 🔒 ممنوع أي قيمة سرية في الرد: موجود/ناقص بس. والأخطاء أكواد قصيرة من
 *    غير روابط ولا مفاتيح (نفس قواعد notify.ts).
 */
export const dynamic = 'force-dynamic'

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

function matchesSecret(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

function denied(request: NextRequest): NextResponse | null {
  const expected = env('REVALIDATE_SECRET')
  const received = (request.headers.get('x-revalidate-secret') ?? '').trim()
  if (expected === '' || received === '' || !matchesSecret(received, expected)) {
    return NextResponse.json({ ok: false, message: 'غير مصرح.' }, { status: 401 })
  }
  return null
}

/** قراءة فعلية صغيرة — مش كاش. */
async function checkDatabase(): Promise<{ ok: boolean; detail: string }> {
  const url = env('SUPABASE_URL').replace(/\/+$/, '')
  const key = env('SUPABASE_READ_KEY') || env('SUPABASE_SERVICE_ROLE_KEY')
  if (url === '' || key === '') return { ok: false, detail: 'SUPABASE_URL أو مفتاح القراءة ناقص' }
  try {
    const response = await fetch(url + '/rest/v1/products?select=id&limit=1', {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return { ok: false, detail: 'الداتابيز ردّت ' + String(response.status) }
    return { ok: true, detail: 'القراءة شغّالة' }
  } catch (error) {
    return { ok: false, detail: error instanceof Error && error.name === 'TimeoutError' ? 'انتهت المهلة' : 'فشل الاتصال' }
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = denied(request)
  if (blocked) return blocked

  const database = await checkDatabase()
  return NextResponse.json(
    {
      ok: true,
      ordersEnabled: env('ORDERS_ENABLED') === 'true',
      dataSource: env('STOREFRONT_DATA_SOURCE') || null,
      present: {
        SUPABASE_URL: env('SUPABASE_URL') !== '',
        SUPABASE_READ_KEY: env('SUPABASE_READ_KEY') !== '',
        SUPABASE_SERVICE_ROLE_KEY: env('SUPABASE_SERVICE_ROLE_KEY') !== '',
        ORDERS_ENABLED: env('ORDERS_ENABLED') !== '',
        TELEGRAM_BOT_TOKEN: env('TELEGRAM_BOT_TOKEN') !== '',
        TELEGRAM_CHAT_ID: env('TELEGRAM_CHAT_ID') !== '',
      },
      database,
      deployment: {
        commit: env('VERCEL_GIT_COMMIT_SHA').slice(0, 7) || null,
        environment: env('VERCEL_ENV') || null,
      },
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const blocked = denied(request)
  if (blocked) return blocked

  let action = ''
  try {
    const body: unknown = await request.json()
    if (typeof body === 'object' && body !== null && 'action' in body) {
      action = String((body as { action: unknown }).action)
    }
  } catch {
    action = ''
  }
  if (action !== 'test-telegram') {
    return NextResponse.json({ ok: false, message: 'إجراء غير معروف.' }, { status: 400 })
  }

  const code = await sendTelegram(
    '🧪 <b>رسالة تجربة من لوحة ZELL</b>\nلو الرسالة دي وصلتك، إشعارات الطلبات شغّالة.',
  )
  return NextResponse.json({ ok: code === null, code }, { headers: { 'Cache-Control': 'no-store' } })
}
