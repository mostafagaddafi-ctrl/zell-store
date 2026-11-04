/**
 * ORDER-DELETE (المرحلة C) — منطق شاشة حذف الطلبات (العقد docs/contracts/ORDER-DELETE.md §١ و§٥-٣): قراءة ردود دوال 0024،
 * التحقق من المدخلات، جملة التأكيد بالعدد، تحويل الأكواد لرسائل، وترتيب خطوات الحذف (بداية المحاولة ← الباسورد ← نهاية
 * المحاولة والتذكرة ← الحذف). منطق خالص من غير server-only ولا شبكة؛ الخطوات الفعلية بتتحقن (pnpm --filter @zell/admin cases).
 */

import type { MutationErrorCode, MutationResult } from '../mutations'

export const ORDER_PURGE_OWNER_ONLY_MESSAGE = 'حذف الطلبات متاح للمالك فقط.'
export const ORDER_PURGE_MAX = 10000

export const ORDER_PURGE_TEXT = {
  singleTitle: 'حذف الطلب نهائيًا',
  allTitle: 'مسح كل الطلبات',
  singleIntro:
    'يحذف هذا الطلب وكل ما يتبعه (الأصناف والسجل والدفعات والشحنة والرسائل) حذفًا نهائيًا. لا تتغير المنتجات ولا الأسعار ولا الإعدادات، ويعود استخدام الكوبون إن وُجد.',
  allIntro:
    'يحذف كل الطلبات الظاهرة في القائمة وكل ما يتبعها حذفًا نهائيًا. الطلبات التي تصل بعد عرض القائمة لا تُحذف. لا تتغير المنتجات ولا الأسعار ولا الإعدادات.',
  open: 'عرض ما سيُحذف',
  reload: 'عرض القائمة من جديد',
  loading: 'جارٍ التحميل…',
  empty: 'لا توجد طلبات للحذف.',
  colNumber: 'الرقم',
  colDate: 'التاريخ',
  colCustomer: 'العميل',
  colPhone: 'التليفون',
  colStatus: 'الحالة',
  colTotal: 'الإجمالي',
  colPayments: 'الدفعات',
  phraseLabel: 'للتأكيد اكتب الجملة التالية كما هي:',
  backupLabel: 'أخذتُ نسخة احتياطية كاملة (backup) قبل المسح.',
  passwordLabel: 'كلمة المرور',
  confirm: 'حذف نهائي',
  deleting: 'جارٍ الحذف…',
  cancel: 'إلغاء',
  noUndo: 'لا يمكن التراجع عن الحذف. الطلبات المحذوفة لا تعود إلا من نسخة احتياطية.',
  backToOrders: 'العودة إلى الطلبات',
}

export const ORDER_PURGE_MESSAGES = {
  unauthenticated: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
  forbidden: ORDER_PURGE_OWNER_ONLY_MESSAGE,
  invalid: 'بيانات الحذف غير صحيحة. اعرض القائمة من جديد.',
  notFound: 'أحد الطلبات لم يعد موجودًا، فلم يُحذف شيء. اعرض القائمة من جديد.',
  dependent: 'يوجد جدول مرتبط بالطلبات غير معتمد للحذف، فلم يُحذف شيء. بلّغ الدعم الفني.',
  changed: 'تغيّر أحد الطلبات أو ما يتبعه بعد عرض القائمة، فلم يُحذف شيء. راجع القائمة الجديدة ثم أكّد مرة أخرى.',
  countMismatch: 'عدد الطلبات لا يطابق القائمة، فلم يُحذف شيء. اعرض القائمة من جديد.',
  ticket: 'انتهت صلاحية التأكيد، فلم يُحذف شيء. أكّد مرة أخرى بكلمة المرور.',
  busy: 'أحد الطلبات قيد التعديل الآن، فلم يُحذف شيء. حاول مرة أخرى بعد قليل.',
  wrongPassword: 'كلمة المرور غير صحيحة، فلم يُحذف شيء.',
  locked: 'تم إيقاف المحاولة مؤقتًا بسبب كثرة المحاولات الخاطئة، فلم يُحذف شيء. حاول بعد ربع ساعة.',
  passwordUnavailable: 'تعذّر التحقق من كلمة المرور الآن، فلم يُحذف شيء. حاول مرة أخرى.',
  phrase: 'جملة التأكيد غير مطابقة.',
  backup: 'يجب تأكيد أخذ نسخة احتياطية قبل المسح الشامل.',
  passwordEmpty: 'اكتب كلمة المرور.',
  previewUnavailable: 'تعذّر تحميل القائمة الآن. حاول مرة أخرى.',
  internal: 'حدث خطأ غير متوقع. اعرض القائمة من جديد للتأكد مما حُذف قبل أي محاولة أخرى.',
}

export type PurgeScope = 'single' | 'all'

export type PurgePreviewOrder = {
  id: number
  orderNumber: string
  createdAt: string
  customerName: string
  customerPhone: string
  status: string
  totalPiastres: number
  paymentsCount: number
  receivedPiastres: number
  refundedPiastres: number
}

export type PurgePreview = {
  ids: number[]
  count: number
  idsHash: string
  snapshotHash: string
  paymentsCount: number
  receivedPiastres: number
  refundedPiastres: number
  orders: PurgePreviewOrder[]
}

export type PurgePreviewResult = MutationResult<PurgePreview>

export type PurgeResult = {
  deleted: number
  orderNumbers: string[]
  paymentsCount: number
  receivedPiastres: number
  refundedPiastres: number
  remainingOrders: number
}

export type PurgeRequest = {
  scope: PurgeScope
  ids: number[]
  idsHash: string
  snapshotHash: string
  count: number
  phrase: string
  backupConfirmed: boolean
  password: string
}

const HASH = /^[0-9a-f]{32}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** قايمة ids صحيحة: أرقام موجبة، من غير تكرار، مرتبة تصاعديًا، ومش أكتر من الحد. */
export function validIds(ids: unknown): ids is number[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > ORDER_PURGE_MAX) return false
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return false
    if (i > 0 && id <= (ids[i - 1] as number)) return false
  }
  return true
}

function parseOrder(raw: unknown): PurgePreviewOrder | null {
  if (!isObj(raw)) return null
  const id = count(raw['id'])
  const orderNumber = text(raw['order_number'])
  const createdAt = text(raw['created_at'])
  const customerName = text(raw['customer_name'])
  const customerPhone = text(raw['customer_phone'])
  const status = text(raw['status'])
  const totalPiastres = count(raw['total_piastres'])
  const paymentsCount = count(raw['payments_count'])
  const receivedPiastres = count(raw['received_piastres'])
  const refundedPiastres = count(raw['refunded_piastres'])
  if (id === null || id < 1 || orderNumber === null || createdAt === null || customerName === null || customerPhone === null) return null
  if (status === null || totalPiastres === null || paymentsCount === null || receivedPiastres === null || refundedPiastres === null) return null
  return { id, orderNumber, createdAt, customerName, customerPhone, status, totalPiastres, paymentsCount, receivedPiastres, refundedPiastres }
}

/** رد zell_purge_preview. أي شكل غلط = null (مفيش حذف على قايمة مش مفهومة). القايمة الفاضية مقبولة (count = 0). */
export function parsePurgePreview(raw: unknown): PurgePreview | null {
  if (!isObj(raw)) return null
  const ids = raw['ids']
  const total = count(raw['count'])
  const idsHash = text(raw['ids_hash'])
  const snapshotHash = text(raw['snapshot_hash'])
  const paymentsCount = count(raw['payments_count'])
  const receivedPiastres = count(raw['received_piastres'])
  const refundedPiastres = count(raw['refunded_piastres'])
  const rawOrders = raw['orders']
  if (!Array.isArray(ids) || total === null || ids.length !== total) return null
  if (total > 0 && !validIds(ids)) return null
  if (idsHash === null || !HASH.test(idsHash) || snapshotHash === null || !HASH.test(snapshotHash)) return null
  if (paymentsCount === null || receivedPiastres === null || refundedPiastres === null) return null
  if (!Array.isArray(rawOrders) || rawOrders.length !== total) return null
  const orders: PurgePreviewOrder[] = []
  for (let i = 0; i < rawOrders.length; i += 1) {
    const order = parseOrder(rawOrders[i])
    if (order === null || order.id !== ids[i]) return null
    orders.push(order)
  }
  return { ids: ids as number[], count: total, idsHash, snapshotHash, paymentsCount, receivedPiastres, refundedPiastres, orders }
}

/** رد zell_purge_orders. */
export function parsePurgeResult(raw: unknown): PurgeResult | null {
  if (!isObj(raw)) return null
  const deleted = count(raw['deleted'])
  const numbers = raw['order_numbers']
  const paymentsCount = count(raw['payments_count'])
  const receivedPiastres = count(raw['received_piastres'])
  const refundedPiastres = count(raw['refunded_piastres'])
  const remainingOrders = count(raw['remaining_orders'])
  if (deleted === null || deleted < 1 || paymentsCount === null || receivedPiastres === null || refundedPiastres === null || remainingOrders === null) return null
  if (!Array.isArray(numbers) || numbers.length !== deleted || numbers.some((n) => typeof n !== 'string')) return null
  return { deleted, orderNumbers: numbers as string[], paymentsCount, receivedPiastres, refundedPiastres, remainingOrders }
}

/** العدد بالكلام: طلب واحد · طلبان · 3–10 طلبات · 11+ طلبًا. */
export function ordersCountText(n: number): string {
  if (n === 1) return 'طلب واحد'
  if (n === 2) return 'طلبان'
  if (n >= 3 && n <= 10) return String(n) + ' طلبات'
  return String(n) + ' طلبًا'
}

/** جملة التأكيد بالعدد (العقد §١-٤). */
export function purgePhrase(n: number): string {
  if (n === 1) return 'احذف طلبًا واحدًا'
  if (n === 2) return 'احذف طلبين'
  if (n >= 3 && n <= 10) return 'احذف ' + String(n) + ' طلبات'
  return 'احذف ' + String(n) + ' طلبًا'
}

/** ملخص تحت القايمة (العقد §١-٣). */
export function purgeSummary(preview: PurgePreview, money: (piastres: number) => string): string {
  return (
    'سيُحذف ' + ordersCountText(preview.count) + ' · ' + String(preview.paymentsCount) + ' دفعة · المقبوض ' + money(preview.receivedPiastres) +
    ' · المردود ' + money(preview.refundedPiastres)
  )
}

/** رسالة بعد المسح الشامل: اللي اتحذف واللي فاضل (طلبات وصلت بعد المعاينة). */
export function purgeDoneNotice(result: PurgeResult): string {
  const head = 'تم حذف ' + ordersCountText(result.deleted) + '.'
  if (result.remainingOrders === 0) return head + ' لا توجد طلبات أخرى.'
  return head + ' بقي ' + ordersCountText(result.remainingOrders) + ' وصل بعد عرض القائمة ولم يُحذف.'
}

/** التحقق قبل أي نداء. null = سليم. */
export function purgeInputIssue(req: PurgeRequest): string | null {
  if (!isObj(req as unknown)) return ORDER_PURGE_MESSAGES.invalid
  if (req.scope !== 'single' && req.scope !== 'all') return ORDER_PURGE_MESSAGES.invalid
  if (!validIds(req.ids) || req.count !== req.ids.length) return ORDER_PURGE_MESSAGES.invalid
  if (req.scope === 'single' && req.count !== 1) return ORDER_PURGE_MESSAGES.invalid
  if (typeof req.idsHash !== 'string' || !HASH.test(req.idsHash) || typeof req.snapshotHash !== 'string' || !HASH.test(req.snapshotHash)) {
    return ORDER_PURGE_MESSAGES.invalid
  }
  if (typeof req.phrase !== 'string' || req.phrase.trim() !== purgePhrase(req.count)) return ORDER_PURGE_MESSAGES.phrase
  if (req.scope === 'all' && req.backupConfirmed !== true) return ORDER_PURGE_MESSAGES.backup
  if (typeof req.password !== 'string' || req.password.length === 0 || req.password.length > 1024) return ORDER_PURGE_MESSAGES.passwordEmpty
  return null
}

const SENTINEL_CODES: Record<string, string> = {
  ZELL_ORD_UNAUTHENTICATED: '45400',
  ZELL_ORD_FORBIDDEN: '45401',
  ZELL_ORD_OWNER_ONLY: '45402',
  ZELL_PURGE_INVALID_INPUT: '45601',
  ZELL_PURGE_NOT_FOUND: '45602',
  ZELL_PURGE_FORBIDDEN: '45603',
  ZELL_PURGE_UNAPPROVED_DEPENDENT: '45604',
  ZELL_PURGE_SNAPSHOT_CHANGED: '45605',
  ZELL_PURGE_COUNT_MISMATCH: '45606',
  ZELL_PURGE_TICKET_INVALID: '45607',
  ZELL_PURGE_BUSY: '45608',
}

/** كود الخطأ من رد supabase-js أو من خطأ مرمي: code بصيغة 45xxx، أو اسم معروف في message. */
export function purgeErrorCode(error: unknown): string | null {
  if (!isObj(error) && !(error instanceof Error)) return null
  const record = error as unknown as Record<string, unknown>
  const code = record['code']
  if (typeof code === 'string' && /^45\d{3}$/.test(code)) return code
  const message = record['message']
  if (typeof message === 'string') {
    for (const name of Object.keys(SENTINEL_CODES)) {
      if (message === name || message.startsWith(name + ':') || message.includes(name)) return SENTINEL_CODES[name] ?? null
    }
  }
  return null
}

export type PurgeFailure = { code: MutationErrorCode; message: string }

/** تحويل خطأ المعاينة أو الحذف لنتيجة اللوحة. أي حاجة مش معروفة = INTERNAL من غير تفاصيل. */
export function purgeFailure(error: unknown): PurgeFailure {
  switch (purgeErrorCode(error)) {
    case '45400':
      return { code: 'UNAUTHENTICATED', message: ORDER_PURGE_MESSAGES.unauthenticated }
    case '45401':
    case '45402':
    case '45603':
      return { code: 'FORBIDDEN', message: ORDER_PURGE_MESSAGES.forbidden }
    case '45601':
      return { code: 'VALIDATION', message: ORDER_PURGE_MESSAGES.invalid }
    case '45602':
      return { code: 'NOT_FOUND', message: ORDER_PURGE_MESSAGES.notFound }
    case '45604':
      return { code: 'CONFLICT', message: ORDER_PURGE_MESSAGES.dependent }
    case '45605':
      return { code: 'CONFLICT', message: ORDER_PURGE_MESSAGES.changed }
    case '45606':
      return { code: 'CONFLICT', message: ORDER_PURGE_MESSAGES.countMismatch }
    case '45607':
      return { code: 'CONFLICT', message: ORDER_PURGE_MESSAGES.ticket }
    case '45608':
      return { code: 'CONFLICT', message: ORDER_PURGE_MESSAGES.busy }
    default:
      return { code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.internal }
  }
}

/** رد zell_purge_reauth_begin: allowed true/false. */
export function parseReauthBegin(raw: unknown): { allowed: boolean } | null {
  if (!isObj(raw) || typeof raw['allowed'] !== 'boolean') return null
  return { allowed: raw['allowed'] }
}

/** رد zell_purge_reauth_finish: تذكرة، أو من غيرها مع locked. */
export function parseReauthFinish(raw: unknown): { ticket: string } | { ticket: null; locked: boolean } | null {
  if (!isObj(raw)) return null
  const ticket = raw['ticket']
  if (typeof ticket === 'string' && UUID.test(ticket)) return { ticket }
  if (ticket === null) return { ticket: null, locked: raw['locked'] === true }
  return null
}

/** الخطوات الفعلية (السيرفر بيحقنها): بداية المحاولة · الباسورد (true · false · null = مش معروف) · نهاية المحاولة · الحذف. */
export type PurgeSteps = {
  begin: () => Promise<unknown>
  verifyPassword: () => Promise<boolean | null>
  finish: (ok: boolean) => Promise<unknown>
  purge: (ticket: string) => Promise<{ data: unknown; error: unknown }>
}

/**
 * الترتيب (العقد §٥-٣): التحقق ← بداية المحاولة (بتتعدّ قبل الباسورد) ← الباسورد ← نهاية المحاولة (غلط: مفيش تذكرة · صح:
 * تذكرة لاستعمال واحد) ← الحذف بالتذكرة. كل خطوة مرة واحدة، ومفيش حذف من غير تذكرة.
 */
export async function runOrderPurge(req: PurgeRequest, steps: PurgeSteps): Promise<MutationResult<PurgeResult>> {
  const issue = purgeInputIssue(req)
  if (issue !== null) return { ok: false, code: 'VALIDATION', message: issue }
  let begin: { allowed: boolean } | null
  try {
    begin = parseReauthBegin(await steps.begin())
  } catch (error) {
    const failure = purgeFailure(error)
    return { ok: false, code: failure.code, message: failure.code === 'INTERNAL' ? ORDER_PURGE_MESSAGES.passwordUnavailable : failure.message }
  }
  if (begin === null) return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.passwordUnavailable }
  if (!begin.allowed) return { ok: false, code: 'VALIDATION', message: ORDER_PURGE_MESSAGES.locked }
  let verified: boolean | null
  try {
    verified = await steps.verifyPassword()
  } catch {
    verified = null
  }
  if (verified === null) return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.passwordUnavailable }
  let finish: { ticket: string } | { ticket: null; locked: boolean } | null
  try {
    finish = parseReauthFinish(await steps.finish(verified))
  } catch (error) {
    const failure = purgeFailure(error)
    return { ok: false, code: failure.code, message: failure.code === 'INTERNAL' ? ORDER_PURGE_MESSAGES.passwordUnavailable : failure.message }
  }
  if (!verified) {
    return { ok: false, code: 'VALIDATION', message: finish !== null && finish.ticket === null && finish.locked ? ORDER_PURGE_MESSAGES.locked : ORDER_PURGE_MESSAGES.wrongPassword }
  }
  if (finish === null || finish.ticket === null) return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.passwordUnavailable }
  let reply: { data: unknown; error: unknown }
  try {
    reply = await steps.purge(finish.ticket)
  } catch {
    return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.internal }
  }
  if (reply.error !== null && reply.error !== undefined) {
    const failure = purgeFailure(reply.error)
    return { ok: false, code: failure.code, message: failure.message }
  }
  const result = parsePurgeResult(reply.data)
  if (result === null || result.deleted !== req.count) return { ok: false, code: 'INTERNAL', message: ORDER_PURGE_MESSAGES.internal }
  return { ok: true, data: result }
}

/** قراية payload التوكن (session_id) من غير تحقق من التوقيع: الداتابيز بتقارنه بجلسة نداء الحذف نفسه، فأي قيمة مزوّرة بتترفض هناك. */
export function sessionIdFromToken(token: unknown, decode: (base64url: string) => string): string | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[1] === undefined || parts[1] === '') return null
  try {
    const payload: unknown = JSON.parse(decode(parts[1]))
    if (!isObj(payload)) return null
    const sid = payload['session_id']
    return typeof sid === 'string' && UUID.test(sid) ? sid : null
  } catch {
    return null
  }
}
