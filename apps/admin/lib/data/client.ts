import 'server-only'

/**
 * عميل قراءة Supabase للوحة — **سيرفر فقط**.
 *
 * 🔒 قواعد ثابتة:
 *   • المفتاح ما يدخلش أي رسالة خطأ ولا لوج ولا استجابة. أبدًا.
 *   • ممنوع أي متغير هنا يبقى NEXT_PUBLIC_.
 *   • ممنوع استيراد الملف ده من Client Component — server-only بيمنعه
 *     وقت البناء مش وقت التشغيل.
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY بيتخطى RLS بالكامل وهو **حل مؤقت**.
 * لازم يتبدل بدور محدود الصلاحية قبل نشر اللوحة.
 *
 * مفيش كاش: اللوحة بتعرض حالة تشغيل لحظية، فأي كاش بيضلّل.
 */

const TIMEOUT_MS = 10000

function credentials(): { url: string; key: string } {
  const url = (process.env['SUPABASE_URL'] ?? '').trim()
  if (url === '') throw new Error('SUPABASE_URL مش متظبط في متغيرات البيئة')

  const key = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim()
  if (key === '') throw new Error('SUPABASE_SERVICE_ROLE_KEY مش متظبط في متغيرات البيئة')

  return { url: url.replace(/\/+$/, ''), key }
}

export function projectUrl(): string {
  return credentials().url
}

/** اسم الخطأ بس — تفاديًا لأي تسريب في اللوجات. */
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' ? 'انتهت المهلة' : error.name
  }
  return 'خطأ غير معروف'
}

/** يقرا الإجمالي الدقيق من هيدر Content-Range بصيغة 0-19/137 */
function parseTotal(contentRange: string | null): number | null {
  if (!contentRange) return null
  const slash = contentRange.lastIndexOf('/')
  if (slash < 0) return null
  const total = Number(contentRange.slice(slash + 1))
  return Number.isFinite(total) ? total : null
}

export type RestResult<T> = { rows: T[]; total: number | null }

export async function restGet<T>(
  table: string,
  query: string,
  options: { exactCount?: boolean } = {},
): Promise<RestResult<T>> {
  const { url, key } = credentials()
  const endpoint = url + '/rest/v1/' + table + '?' + query

  const headers: Record<string, string> = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    Accept: 'application/json',
  }
  // عدّ دقيق — قرار معتمد
  if (options.exactCount) headers['Prefer'] = 'count=exact'

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error('فشل الاتصال بجدول ' + table + ': ' + describeFailure(error))
  }

  if (!response.ok) {
    throw new Error('استعلام ' + table + ' رجّع ' + String(response.status) + ' ' + response.statusText)
  }

  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) {
    throw new Error('استعلام ' + table + ' رجّع شكل غير متوقع')
  }

  return { rows: payload as T[], total: parseTotal(response.headers.get('content-range')) }
}

/** بناء فلتر in.(...) بقيم مشفّرة — الأقواس والفواصل حرفية. */
export function inFilter(values: readonly string[]): string {
  return 'in.(' + values.map((value) => '"' + encodeURIComponent(value) + '"').join(',') + ')'
}
