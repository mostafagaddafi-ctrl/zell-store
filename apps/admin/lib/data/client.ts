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

// ── الكتابة ──────────────────────────────────────────────────
/**
 * ⚠️ الدوال دي **مش** CRUD عام.
 *
 * أسماء الجداول والدوال بتيجي من ثوابت مكتوبة في lib/mutations/* بس،
 * وكل اسم بيتفحص بنمط صريح قبل ما يدخل في URL. مفيش أي مسار بياخد
 * اسم جدول ولا اسم عمود من مدخلات المستخدم.
 *
 * ومفيش trigger على updated_at في أي جدول — فكل PATCH لازم يبعت
 * updated_at بنفسه. ده مش تفصيلة تجميلية: من غيره التزامن التفاؤلي
 * بيبقى بلا معنى لأن الطابع مابيتغيرش.
 */

const IDENTIFIER = /^[a-z][a-z0-9_]*$/

function safeIdentifier(value: string, what: string): string {
  if (!IDENTIFIER.test(value)) throw new Error('اسم ' + what + ' غير مسموح')
  return value
}

/**
 * رموز خطأ **إحنا** اللي عرّفناها جوه دوال الداتابيز.
 *
 * القايمة مقفولة عن قصد. جسم رد Supabase بيتقرا **بس** عشان نطابق
 * رمز من القايمة دي، وبعدين بيترمي. ولا حرف منه بيوصل لطبقة أعلى
 * ولا لأي رسالة بتوصل للعميل.
 *
 * ليه محتاجينه: دوال الترتيب بترمي ZELL_INVALID_ORDER لما المجموعة
 * المبعوتة مش مساوية للموجود. من غير التمييز ده كان الفشل المتوقع
 * ده بيبان INTERNAL، وده بيخفي خطأ مدخلات ورا رسالة "خطأ غير متوقع".
 */
const KNOWN_SENTINELS = ['ZELL_INVALID_ORDER', 'ZELL_INVALID_SHIPPING', 'ZELL_INVALID_IDENTITY'] as const

export type DbSentinel = (typeof KNOWN_SENTINELS)[number]

class DbCallError extends Error {
  readonly sentinel: DbSentinel | null

  constructor(message: string, sentinel: DbSentinel | null) {
    super(message)
    this.name = 'DbCallError'
    this.sentinel = sentinel
  }
}

/** بيرجّع الرمز المعروف لو الفشل كان واحد منهم، وإلا null. */
export function sentinelOf(error: unknown): DbSentinel | null {
  return error instanceof DbCallError ? error.sentinel : null
}

/** سقف قراءة جسم الخطأ. ماينفعش نقرا رد ضخم عشان رمز واحد. */
const MAX_ERROR_BODY_BYTES = 8192

/**
 * بيقرا جسم الخطأ بحد أقصى 8 كيلوبايت.
 * بيرجّع null لو مفيش جسم، أو أكبر من السقف، أو القراءة فشلت —
 * والتلات حالات بتنتهي INTERNAL.
 */
async function readCappedBody(response: Response): Promise<string | null> {
  const stream = response.body
  if (!stream) return null

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const step = await reader.read()
      if (step.done) break
      const chunk = step.value
      if (!chunk) continue
      total += chunk.byteLength
      if (total > MAX_ERROR_BODY_BYTES) return null
      chunks.push(chunk)
    }
  } catch {
    return null
  } finally {
    try {
      await reader.cancel()
    } catch {
      // الرد اتقفل بالفعل — مش مشكلة
    }
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(merged)
}

/** الحقول الوحيدة اللي بنبصّ فيها من رد PostgREST. */
type PostgrestErrorBody = {
  message?: unknown
  details?: unknown
}

/**
 * مطابقة **منظّمة** مش بحث حر في النص.
 *
 * البحث الحر (body.includes) كان ممكن يصنّف خطأ مالوش علاقة كـ
 * VALIDATION لو الرمز ظهر بالصدفة جوه تفاصيل أو سياق تاني. عشان كده
 * بنقرا حقل message أو details **بس**، وبنقبل تطابق تام أو بادئة
 * CODE: معروفة.
 *
 * أي جسم مش JSON، أو مش كائن، أو مفيهوش حقل نصي، أو فيه نص مش
 * مطابق — كله بيرجع null ويبقى INTERNAL.
 *
 * الكائن المفكوك بيتسيب هنا وماينتقلش لأي طبقة تانية.
 */
function matchSentinel(body: string): DbSentinel | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const payload = parsed as PostgrestErrorBody
  const candidate =
    typeof payload.message === 'string'
      ? payload.message
      : typeof payload.details === 'string'
        ? payload.details
        : ''
  if (candidate === '') return null

  for (const code of KNOWN_SENTINELS) {
    if (candidate === code) return code
    if (candidate.startsWith(code + ':')) return code
  }
  return null
}

async function sendWrite<T>(args: {
  method: 'POST' | 'PATCH'
  path: string
  body: unknown
  what: string
}): Promise<T> {
  const { url, key } = credentials()

  let response: Response
  try {
    response = await fetch(url + args.path, {
      method: args.method,
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(args.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error('فشل الاتصال أثناء ' + args.what + ': ' + describeFailure(error))
  }

  if (!response.ok) {
    // الجسم بيتقرا **بس** لمطابقة رمز معروف، وبعدين بيترمي.
    // رسالة الاستثناء فيها الحالة بس — ولا حرف من رد Supabase.
    let sentinel: DbSentinel | null = null
    try {
      const body = await readCappedBody(response)
      if (body !== null) sentinel = matchSentinel(body)
    } catch {
      sentinel = null
    }
    throw new DbCallError(
      args.what + ' رجّع ' + String(response.status) + ' ' + response.statusText,
      sentinel,
    )
  }

  const text = await response.text()
  if (text === '') return null as T
  return JSON.parse(text) as T
}

/**
 * PATCH بفلتر صريح.
 * بيرجّع الصفوف المتأثرة — قائمة فاضية يعني **مفيش صف طابق الفلتر**،
 * وده اللي التزامن التفاؤلي بيعتمد عليه.
 */
export async function restPatch<T>(table: string, query: string, changes: Record<string, unknown>): Promise<T[]> {
  const name = safeIdentifier(table, 'الجدول')
  const rows = await sendWrite<T[] | null>({
    method: 'PATCH',
    path: '/rest/v1/' + name + '?' + query,
    body: changes,
    what: 'تعديل ' + name,
  })
  return rows ?? []
}

export async function restInsert<T>(table: string, changes: Record<string, unknown>, select?: string): Promise<T[]> {
  const name = safeIdentifier(table, 'الجدول')
  const suffix = select === undefined ? '' : '?select=' + select
  const rows = await sendWrite<T[] | null>({
    method: 'POST',
    path: '/rest/v1/' + name + suffix,
    body: changes,
    what: 'إضافة في ' + name,
  })
  return rows ?? []
}

/**
 * نداء دالة داتابيز.
 * الذرّية مسؤولية الدالة نفسها — الكود هنا مابيحاولش يقلّدها.
 */
export async function restRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const name = safeIdentifier(fn, 'الدالة')
  return sendWrite<T>({
    method: 'POST',
    path: '/rest/v1/rpc/' + name,
    body: args,
    what: 'نداء ' + name,
  })
}

// ── Storage ──────────────────────────────────────────────────
/**
 * ⚠️ الدوال دي **مش** بروكسي عام لـ Storage.
 *
 * اسم الـ bucket ثابت هنا، والمسار بيتبنى في السيرفر من UUID.
 * مفيش دالة واحدة بتاخد bucket ولا path من العميل، وبالتالي مفيش
 * طريقة يوصل بيها نداء لمسار مش إحنا اللي بنيناه.
 */
const IMAGE_BUCKET = 'product-images'

/** الرفع أبطأ من الاستعلام — مهلة أطول. */
const STORAGE_TIMEOUT_MS = 30000

export function imageBucket(): string {
  return IMAGE_BUCKET
}

function encodeObjectPath(objectPath: string): string {
  return objectPath
    .split('/')
    .filter((part) => part !== '')
    .map(encodeURIComponent)
    .join('/')
}

function storageUrl(url: string, objectPath: string): string {
  return url + '/storage/v1/object/' + IMAGE_BUCKET + '/' + encodeObjectPath(objectPath)
}

/** x-upsert: false — الكتابة فوق ملف موجود ممنوعة. */
export async function storageUpload(objectPath: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { url, key } = credentials()

  let response: Response
  try {
    response = await fetch(storageUrl(url, objectPath), {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'x-upsert': 'false',
      },
      body: bytes,
      cache: 'no-store',
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error('فشل رفع الملف: ' + describeFailure(error))
  }

  if (!response.ok) {
    throw new Error('رفع الملف رجّع ' + String(response.status) + ' ' + response.statusText)
  }
}

export async function storageDelete(objectPath: string): Promise<void> {
  const { url, key } = credentials()

  let response: Response
  try {
    response = await fetch(storageUrl(url, objectPath), {
      method: 'DELETE',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error('فشل حذف الملف: ' + describeFailure(error))
  }

  if (!response.ok) {
    throw new Error('حذف الملف رجّع ' + String(response.status) + ' ' + response.statusText)
  }
}

/**
 * DELETE بفلتر صريح.
 * ⚠️ الاستخدام الوحيد المسموح دلوقتي هو **التراجع** بعد فشل رفع صورة.
 * حذف الصور كميزة لسه برّه النطاق.
 */
export async function restDelete(table: string, query: string): Promise<void> {
  const name = safeIdentifier(table, 'الجدول')
  const { url, key } = credentials()

  let response: Response
  try {
    response = await fetch(url + '/rest/v1/' + name + '?' + query, {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
        Prefer: 'return=minimal',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error('فشل الحذف من ' + name + ': ' + describeFailure(error))
  }

  if (!response.ok) {
    throw new Error('الحذف من ' + name + ' رجّع ' + String(response.status) + ' ' + response.statusText)
  }
}
