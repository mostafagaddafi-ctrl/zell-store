/**
 * حراس الطلب المشتركة بين POST /api/orders و POST /api/coupons/preview.
 *
 * اتنقلوا من راوت الطلب بالحرف — نفس الترتيب ونفس الأكواد ونفس الحدود — عشان المعاينة
 * ماتنسخش الفحص. مفيش أي تغيير في سلوك راوت الطلب.
 *
 * الشكل المطلوب من الطلب أقل حاجة (headers + text) فـNextRequest بيعدّي، والحالات بتختبر بيه
 * من غير Next.
 */

export type GuardRequest = {
  headers: Headers
  text(): Promise<string>
}

/** فحص المنشأ: Sec-Fetch-Site لو موجود، و Origin إلزامي ولازم يطابق المضيف. */
export function isSameOrigin(headers: Headers, fallbackHost: string): boolean {
  const site = headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return false

  const origin = headers.get('origin')
  if (origin === null) return false

  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }

  const host = headers.get('host')
  if (host !== null && host !== '') return originHost === host
  return originHost === fallbackHost
}

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'BAD_CONTENT_TYPE' | 'BODY_TOO_LARGE' | 'BAD_JSON' }

/**
 * JSON بس، وبحد بايتات حقيقي.
 *
 * فحص مبكر على Content-Length لو موجود — بيرفض قبل قراءة الـbody خالص. الهيدر **مش موثوق**
 * وممكن يبقى غايب أو كذب، فالفحص الحقيقي بعد القراءة باقي زي ما هو. الاتنين مطلوبين:
 * ده بيوفّر القراءة، وده بيضمن الحد (بالبايت مش بعدد الحروف).
 */
export async function readJsonBody(request: GuardRequest, maxBytes: number): Promise<JsonBodyResult> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) return { ok: false, code: 'BAD_CONTENT_TYPE' }

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { ok: false, code: 'BODY_TOO_LARGE' }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return { ok: false, code: 'BAD_JSON' }
  }
  if (new TextEncoder().encode(raw).length > maxBytes) return { ok: false, code: 'BODY_TOO_LARGE' }

  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false, code: 'BAD_JSON' }
  }
}
