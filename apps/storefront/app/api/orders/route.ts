import { NextResponse, after, type NextRequest } from 'next/server'
import { isValidEgyptianPhone } from '@zell/core'
import { restRpc, type RpcResult } from '../../../lib/data/rpc'
import type { CreateOrderResult, OrderErrorCode, OrderItemInput, OrderRequest } from '../../../lib/orders/contracts'
import { codeFromSqlError, orderFailure, statusFor } from '../../../lib/orders/errors'
import { CHECKOUT_SESSION_COOKIE, checkoutSessionHash } from '../../../lib/orders/checkoutSession'
import { notifyNewOrder } from '../../../lib/orders/notify'
import { normalizeOrder, requestHash } from '../../../lib/orders/requestHash'
import {
  RECEIPT_MAX_AGE_SECONDS,
  newReceiptSecret,
  receiptCookieName,
  receiptCookiePath,
  receiptTokenHash,
} from '../../../lib/orders/receiptToken'

/**
 * POST /api/orders — نقطة إنشاء الطلب الوحيدة (ORDER-FLOW-PLAN.md §3 · §5.2 · §6.3).
 *
 * 🔒 ثوابت:
 *   • ORDERS_ENABLED مقفولة افتراضياً — الدمج والنشر ما بيفتحوش الاستقبال.
 *   • السعر المعتمد بيتحسب في الداتابيز. **أي رقم جاي من المتصفح بيتجاهل** —
 *     العقد ما بيقبلش أسعار أصلاً، بس productId و lengthCm.
 *   • سر الإيصال بيترجع في Set-Cookie في **نفس الرد**، وعمره ما يدخل JSON.
 *   • الرسالة للعميل **دايماً** من جدول §1.3 — مفيش رسالة محرّك خام أبداً.
 *
 *   • الإشعار (§7) بيتنفّذ جوه after() **بعد** ما الرد يروح للعميل، فمستحيل
 *     يأخّر الرد أو يفشّل الطلب. و**ممنوع** على الـreplay (ب٦).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024
const MAX_ITEMS = 20
const MAX_NOTES = 500
const MIN_KEY_LENGTH = 16
const MAX_KEY_LENGTH = 128

function fail(code: OrderErrorCode): NextResponse {
  return NextResponse.json(orderFailure(code), { status: statusFor(code) })
}

/** فحص المنشأ: Sec-Fetch-Site لو موجود، و Origin إلزامي ولازم يطابق المضيف. */
function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return false

  const origin = request.headers.get('origin')
  if (origin === null) return false

  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }

  const host = request.headers.get('host')
  if (host !== null && host !== '') return originHost === host
  return originHost === request.nextUrl.host
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * فحص شكل رخيص قبل أي نداء داتابيز. **الداتابيز هي المرجع** — الفحص هنا
 * بيوفّر رحلة شبكة ويدّي كود خطأ أدق، مش بيستبدل تحقق zell_create_order.
 */
function parseRequest(payload: unknown): { ok: true; value: OrderRequest } | { ok: false; code: OrderErrorCode } {
  if (!isPlainObject(payload)) return { ok: false, code: 'BAD_JSON' }

  const name = typeof payload['customerName'] === 'string' ? payload['customerName'] : ''
  const phone = typeof payload['customerPhone'] === 'string' ? payload['customerPhone'] : ''
  const governorate = typeof payload['governorate'] === 'string' ? payload['governorate'] : ''
  const address = typeof payload['address'] === 'string' ? payload['address'] : ''
  const rawNotes = payload['notes']
  const notes = typeof rawNotes === 'string' ? rawNotes : null

  if (name.trim().length < 3) return { ok: false, code: 'INVALID_NAME' }
  if (!isValidEgyptianPhone(phone)) return { ok: false, code: 'INVALID_PHONE' }
  if (address.trim().length < 8) return { ok: false, code: 'INVALID_ADDRESS' }
  if (notes !== null && notes.trim().length > MAX_NOTES) return { ok: false, code: 'NOTES_TOO_LONG' }
  if (governorate.trim() === '') return { ok: false, code: 'GOVERNORATE_NOT_SERVED' }

  const rawItems = payload['items']
  if (!Array.isArray(rawItems)) return { ok: false, code: 'CART_INVALID' }
  if (rawItems.length === 0) return { ok: false, code: 'CART_EMPTY' }
  if (rawItems.length > MAX_ITEMS) return { ok: false, code: 'CART_TOO_LARGE' }

  const items: OrderItemInput[] = []
  for (const entry of rawItems) {
    if (!isPlainObject(entry)) return { ok: false, code: 'CART_INVALID' }
    const productId = entry['productId']
    const lengthCm = entry['lengthCm']
    if (!isPositiveInteger(productId) || !isPositiveInteger(lengthCm)) return { ok: false, code: 'CART_INVALID' }
    items.push({ productId, lengthCm })
  }

  return {
    ok: true,
    value: { customerName: name, customerPhone: phone, governorate, address, notes, items },
  }
}

function isCreateOrderResult(value: unknown): value is CreateOrderResult {
  if (!isPlainObject(value)) return false
  return (
    typeof value['order_number'] === 'string' &&
    typeof value['replayed'] === 'boolean' &&
    typeof value['subtotal_piastres'] === 'number' &&
    typeof value['shipping_piastres'] === 'number' &&
    typeof value['total_piastres'] === 'number' &&
    typeof value['receipt_expires_at'] === 'string'
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // (١) البوّابة — قبل أي قراءة
  if ((process.env['ORDERS_ENABLED'] ?? '').trim() !== 'true') return fail('ORDERS_DISABLED')

  // (٢) شكل الطلب — قاطع ورخيص
  if (!isSameOrigin(request)) return fail('BAD_ORIGIN')

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) return fail('BAD_CONTENT_TYPE')

  // فحص مبكر على Content-Length لو موجود — بيرفض قبل قراءة الـbody خالص.
  // الهيدر **مش موثوق** وممكن يبقى غايب أو كذب، فالفحص الحقيقي بعد القراءة
  // باقي زي ما هو. الاتنين مطلوبين: ده بيوفّر القراءة، وده بيضمن الحد.
  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return fail('BODY_TOO_LARGE')

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return fail('BAD_JSON')
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail('BODY_TOO_LARGE')

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return fail('BAD_JSON')
  }

  // (٣) المفتاح — مش سر، بس إلزامي
  const idempotencyKey = (request.headers.get('idempotency-key') ?? '').trim()
  if (idempotencyKey.length < MIN_KEY_LENGTH || idempotencyKey.length > MAX_KEY_LENGTH) {
    return fail('IDEMPOTENCY_REQUIRED')
  }

  // (٤) كوكي الجلسة — إثبات «المتصفح ده» (ب١٠). مطلوبة في **كل** submit.
  const sessionSecret = (request.cookies.get(CHECKOUT_SESSION_COOKIE)?.value ?? '').trim()
  if (sessionSecret === '') return fail('CHECKOUT_SESSION_MISSING')

  // (٥) الشكل
  const parsed = parseRequest(payload)
  if (!parsed.ok) return fail(parsed.code)

  // (٦) الهاشات — كلها سيرفر-سايد، والعميل عمره ما بعت ولا واحد فيهم
  const normalized = normalizeOrder(parsed.value)
  const receiptSecret = newReceiptSecret()

  let requestHashHex: string
  let sessionHashHex: string
  let receiptHashHex: string
  try {
    requestHashHex = await requestHash(normalized)
    sessionHashHex = await checkoutSessionHash(sessionSecret)
    receiptHashHex = await receiptTokenHash(receiptSecret)
  } catch {
    return fail('INTERNAL')
  }

  // (٧) المعاملة الذرّية
  //
  // ⚠️ restRpc بترمي لو الـcredentials ناقصة. الـtry هنا **إلزامي**: من غيره
  //    إعداد ناقص بيطلع صفحة خطأ عامة من Next بدل عقد INTERNAL الثابت،
  //    وده بيخرق قاعدة «الرسالة دايماً من جدول §1.3».
  let result: RpcResult<unknown>
  try {
    result = await restRpc<unknown>('zell_create_order', {
      p_items: normalized.items.map((item) => ({ productId: item.productId, lengthCm: item.lengthCm })),
      p_customer_name: normalized.customerName,
      p_customer_phone: normalized.customerPhone,
      p_governorate: normalized.governorate,
      p_address: normalized.address,
      p_notes: normalized.notes,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHashHex,
      p_checkout_session_hash: sessionHashHex,
      p_receipt_token_hash: receiptHashHex,
    })
  } catch (error) {
    // اسم الاستثناء بس — مفيش مفتاح ولا رابط ولا بيانات عميل في اللوج
    console.error('[orders] INTERNAL :: rpc threw ' + (error instanceof Error ? error.name : 'unknown'))
    return fail('INTERNAL')
  }

  if (!result.ok) {
    const code = codeFromSqlError(result.sqlMessage)
    // اللوج سيرفر-سايد بس. مفيش مفتاح ولا سر ولا بيانات عميل هنا.
    console.error('[orders] ' + code + (code === 'INTERNAL' ? ' :: ' + result.sqlMessage : ''))
    return fail(code)
  }

  if (!isCreateOrderResult(result.data)) {
    console.error('[orders] INTERNAL :: unexpected zell_create_order shape')
    return fail('INTERNAL')
  }

  const order = result.data

  // (٨) عمر الكوكي من الداتابيز — مش ثابت (§6.4ب · 0006c).
  //
  // receipt_expires_at بيتكتب مرة واحدة عند الإنشاء و**ما بيتمدّش**، فالكوكي
  // ممنوع تدّعي صلاحية أطول منه. الحد الأقصى برضه مفروض عشان قيمة غريبة من
  // الداتابيز ما تطلعش كوكي أبدية.
  const expiresAtMs = Date.parse(order.receipt_expires_at)
  if (!Number.isFinite(expiresAtMs)) {
    console.error('[orders] INTERNAL :: unparsable receipt_expires_at')
    return fail('INTERNAL')
  }
  const remainingSeconds = Math.floor((expiresAtMs - Date.now()) / 1000)
  const receiptMaxAge = Math.min(RECEIPT_MAX_AGE_SECONDS, Math.max(0, remainingSeconds))

  const response = NextResponse.json(
    {
      ok: true,
      order: {
        orderNumber: order.order_number,
        subtotalPiastres: order.subtotal_piastres,
        shippingPiastres: order.shipping_piastres,
        totalPiastres: order.total_piastres,
        replayed: order.replayed,
      },
    },
    { status: order.replayed ? 200 : 201 },
  )

  if (receiptMaxAge > 0) {
    // السر الخام بيسافر هنا وبس — HttpOnly ومقيّد بمسار الطلب (ب٨ + ب٩).
    response.cookies.set({
      name: receiptCookieName(order.order_number),
      value: receiptSecret,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: receiptCookiePath(order.order_number),
      maxAge: receiptMaxAge,
    })
  } else {
    // النافذة خلصت أصلاً — يعني replay لطلب أقدم من ٧ أيام. **ممنوع** نضبط
    // كوكي بتدّعي صلاحية مش موجودة؛ zell_get_order_receipt هترفضها برضه.
    //
    // ⚠️ بنرجّع العقد الناجح من غير كوكي، **مش** INTERNAL: الطلب نفسه سليم
    //    ومسجّل، و INTERNAL عنده retryable = true فكان هيعمل حلقة إعادة محاولة
    //    لا نهائية على حالة ثابتة ما بتتغيّرش. صفحة الإيصال بتقول «غير متاح»
    //    وهي الحقيقة بالظبط.
    console.error('[orders] receipt window already closed on replay :: ' + order.order_number)
  }

  // (٩) الإشعار — بعد الرد، و**بس** لما يكون طلب جديد فعلاً (§7.2 · ب٦).
  //
  // الحارس الأول ضد الإشعار المكرر هو الشرط ده. الحارس التاني
  // `notified_at is null` جوه تحديث النجاح في notify.ts.
  //
  // after() بيأجّل التنفيذ لبعد ما الاستجابة تتبعت: زمن الرد مش معلّق على
  // تليجرام، ومهلة الراوت مش مهدّدة، وأي فشل مستحيل يأثّر على الرد ولا على
  // كوكي الإيصال (§7.1).
  if (!order.replayed) {
    after(async () => {
      await notifyNewOrder(order.order_number)
    })
  }

  return response
}
