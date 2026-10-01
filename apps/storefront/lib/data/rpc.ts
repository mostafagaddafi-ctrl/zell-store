import 'server-only'

/**
 * نداء RPC على Supabase — **سيرفر فقط**.
 *
 * 🔒 قواعد ثابتة:
 *   • المفتاح ما يدخلش أي رسالة خطأ ولا لوج ولا استجابة. أبداً.
 *   • ممنوع أي متغير هنا يبقى NEXT_PUBLIC_.
 *   • ممنوع استيراد الملف ده من Client Component (server-only بيمنع ده بناءً).
 *
 * ⚠️ الدالتين zell_create_order و zell_get_order_receipt ممنوحتين لـ
 *    service_role و zell_order_writer بس. و zell_order_writer معمول
 *    nologin فمحدش بيقدر يتصل بيه — فالنداء بيمشي على مفتاح الخدمة.
 *    ده حل **انتقالي** موثّق في 0006b: لما يتعمل دور متصل مقيّد، التبديل
 *    بيبقى متغير بيئة واحد من غير أي تعديل كود، لأن المسار ده ما بيلمسش
 *    أي جدول — دالتين وبس.
 *
 * ⚠️ SUPABASE_READ_KEY **مش** بديل هنا: دور القراءة المحدود مالوش execute
 *    على الدالتين، فالـfallback كان هيفشل بخطأ صلاحيات غامض.
 */

const TIMEOUT_MS = 10000

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; sqlMessage: string }

function readCredentials(): { url: string; key: string } {
  const url = (process.env['SUPABASE_URL'] ?? '').trim()
  if (url === '') throw new Error('SUPABASE_URL مش متظبط في متغيرات البيئة')

  const key = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim()
  if (key === '') throw new Error('SUPABASE_SERVICE_ROLE_KEY مش متظبط — مطلوب لاستدعاء دوال الطلب')

  return { url: url.replace(/\/+$/, ''), key }
}

/** اسم الخطأ بس من غير أي تفاصيل، تفاديًا لأي تسريب في اللوجات. */
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' ? 'انتهت المهلة بعد ١٠ ثواني' : error.name
  }
  return 'خطأ غير معروف'
}

export async function restRpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const { url, key } = readCredentials()

  let response: Response
  try {
    response = await fetch(url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // الرسالة بتذكر اسم الدالة بس — مفيش رابط كامل ولا هيدرز ولا مفتاح
    return { ok: false, status: 0, sqlMessage: 'فشل الاتصال بدالة ' + fn + ': ' + describeFailure(error) }
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload !== null && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : 'رد غير متوقع من ' + fn + ' بحالة ' + String(response.status)
    return { ok: false, status: response.status, sqlMessage: message }
  }

  return { ok: true, data: payload as T }
}
