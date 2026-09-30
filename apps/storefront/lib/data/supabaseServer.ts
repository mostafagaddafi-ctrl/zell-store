import 'server-only'

/**
 * عميل قراءة Supabase عبر PostgREST — **سيرفر فقط**.
 *
 * 🔒 قواعد ثابتة:
 *   • المفتاح ما يدخلش أي رسالة خطأ ولا لوج ولا استجابة. أبدًا.
 *   • ممنوع أي متغير هنا يبقى NEXT_PUBLIC_.
 *   • ممنوع استيراد الملف ده من Client Component (server-only بيمنع ده وقت البناء).
 *
 * ترتيب المفاتيح:
 *   1. SUPABASE_READ_KEY            ← دور قراءة محدود الصلاحية (المستهدف)
 *   2. SUPABASE_SERVICE_ROLE_KEY    ← ⚠️ مؤقت. بيتخطى RLS بالكامل.
 *
 * الـ service-role حل انتقالي للاتصال الأول بس، ولازم يتبدل بدور قراءة
 * محدود. الاستبدال وقتها = متغير بيئة واحد من غير أي تعديل كود.
 */

// تذكير: المتغيرات دي لازم تكون متعلّمة على **كل** بيئة بتبني المشروع
// في Vercel — Production و Preview. تعديلها في اللوحة مابيعيدش البناء
// لوحده؛ محتاج نشر جديد.
const TIMEOUT_MS = 8000

type Credentials = { url: string; key: string }

function readCredentials(): Credentials {
  const url = (process.env['SUPABASE_URL'] ?? '').trim()
  if (url === '') {
    throw new Error('SUPABASE_URL مش متظبط في متغيرات البيئة')
  }

  const readKey = (process.env['SUPABASE_READ_KEY'] ?? '').trim()
  const serviceKey = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim()
  const key = readKey !== '' ? readKey : serviceKey

  if (key === '') {
    throw new Error('مفيش مفتاح قراءة: ظبط SUPABASE_READ_KEY أو مؤقتًا SUPABASE_SERVICE_ROLE_KEY')
  }

  return { url: url.replace(/\/+$/, ''), key }
}

/** رابط المشروع — محتاجينه لتركيب روابط الصور العامة. */
export function supabaseProjectUrl(): string {
  return readCredentials().url
}

/** اسم الخطأ بس من غير أي تفاصيل، تفاديًا لأي تسريب في اللوجات. */
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' ? 'انتهت المهلة بعد ٨ ثواني' : error.name
  }
  return 'خطأ غير معروف'
}

export async function restGet<T>(table: string, query: string, revalidateSeconds: number): Promise<T[]> {
  const { url, key } = readCredentials()
  const endpoint = url + '/rest/v1/' + table + '?' + query

  const init: RequestInit & { next?: { revalidate: number } } = {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: revalidateSeconds },
  }

  let response: Response
  try {
    response = await fetch(endpoint, init)
  } catch (error) {
    // الرسالة بتذكر الجدول بس — مفيش رابط كامل ولا هيدرز
    throw new Error('فشل الاتصال بجدول ' + table + ': ' + describeFailure(error))
  }

  if (!response.ok) {
    throw new Error('استعلام ' + table + ' رجّع ' + String(response.status) + ' ' + response.statusText)
  }

  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) {
    throw new Error('استعلام ' + table + ' رجّع شكل غير متوقع')
  }

  return payload as T[]
}
