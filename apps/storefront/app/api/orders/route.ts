import { NextResponse, after, type NextRequest } from 'next/server'
import { isValidEgyptianPhone, parsePreferredDeliveryField } from '@zell/core'
import { readCheckoutDeliverySettings } from '../../../lib/data/deliverySettings'
import { restRpc } from '../../../lib/data/rpc'
import type { OrderErrorCode, OrderItemInput, OrderRequest } from '../../../lib/orders/contracts'
import { codeFromSqlError, orderFailure, statusFor } from '../../../lib/orders/errors'
import { CHECKOUT_SESSION_COOKIE, checkoutSessionHash } from '../../../lib/orders/checkoutSession'
import { parseCouponCodeField } from '../../../lib/orders/coupon'
import { notifyNewOrder } from '../../../lib/orders/notify'
import { placeOrder } from '../../../lib/orders/placeOrder'
import {
  RECEIPT_MAX_AGE_SECONDS,
  newReceiptSecret,
  receiptCookieName,
  receiptCookiePath,
  receiptTokenHash,
} from '../../../lib/orders/receiptToken'
import { isSameOrigin, readJsonBody } from '../../../lib/orders/requestGuards'
import { isCreateOrderResult, orderSuccessBody } from '../../../lib/orders/result'

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
/** 0018 — نفس حد zell_create_order (c_max_area) وحد اللوحة. */
const MAX_AREA = 40
const MIN_KEY_LENGTH = 16
const MAX_KEY_LENGTH = 128

function fail(code: OrderErrorCode): NextResponse {
  return NextResponse.json(orderFailure(code), { status: statusFor(code) })
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
    if (!isPositiveInteger(productId)) return { ok: false, code: 'CART_INVALID' }
    // 0016 — صنف قطعة: عدد بس، من غير طول ولا عرض (الداتابيز بتتأكد إن المنتج قطعة)
    const quantity = entry['quantity']
    if (quantity !== undefined && quantity !== null) {
      if (!isPositiveInteger(quantity) || quantity > 999) return { ok: false, code: 'CART_INVALID' }
      if (entry['lengthCm'] !== undefined || entry['widthCm'] !== undefined) return { ok: false, code: 'CART_INVALID' }
      items.push({ productId, quantity })
      continue
    }
    const lengthCm = entry['lengthCm']
    if (!isPositiveInteger(lengthCm)) return { ok: false, code: 'CART_INVALID' }
    // 0015 — العرض اختياري؛ لو موجود لازم رقم صحيح موجب (الداتابيز بتتأكد إنه متاح)
    const widthCm = entry['widthCm']
    if (widthCm === undefined || widthCm === null) {
      items.push({ productId, lengthCm })
    } else {
      if (!isPositiveInteger(widthCm)) return { ok: false, code: 'CART_INVALID' }
      items.push({ productId, lengthCm, widthCm })
    }
  }

  // 0018 — المنطقة معامل صريح (NFC + trim، فاضي = مفيش). الداتابيز بتتأكد إنها من مناطق المحافظة.
  const rawArea = payload['area']
  let area: string | undefined
  if (rawArea !== undefined && rawArea !== null) {
    if (typeof rawArea !== 'string') return { ok: false, code: 'AREA_INVALID' }
    const trimmed = rawArea.normalize('NFC').trim()
    if (trimmed.length > MAX_AREA) return { ok: false, code: 'AREA_INVALID' }
    if (trimmed !== '') area = trimmed
  }

  // 0018 — الفني true أو مش موجود. الداتابيز هي اللي بتقرر هو متاح ولا لأ.
  const rawInstallation = payload['installation']
  if (rawInstallation !== undefined && rawInstallation !== null && typeof rawInstallation !== 'boolean') {
    return { ok: false, code: 'CART_INVALID' }
  }
  const installation = rawInstallation === true
  if (installation && area === undefined) return { ok: false, code: 'INSTALLATION_NOT_AVAILABLE' }

  // 0019 — كود الخصم بس (مفيش أي مبلغ بيتقري). فاضي = مفيش كوبون. غير صالح = COUPON_INVALID قبل أي نداء داتابيز.
  const coupon = parseCouponCodeField(payload['couponCode'])
  if (!coupon.ok) return { ok: false, code: 'COUPON_INVALID' }

  // 0021-D — الموعد المفضّل (اختياري). غايب = النداء القديم بالحرف. شكل غلط = PREFERRED_DELIVERY_INVALID قبل أي نداء.
  const preferred = parsePreferredDeliveryField(payload['preferredDelivery'])
  if (!preferred.ok) return { ok: false, code: 'PREFERRED_DELIVERY_INVALID' }

  const value: OrderRequest = { customerName: name, customerPhone: phone, governorate, address, notes, items }
  if (area !== undefined) value.area = area
  if (installation) value.installation = true
  if (coupon.code !== null) value.couponCode = coupon.code
  if (preferred.value !== null) value.preferredDelivery = preferred.value
  return { ok: true, value }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // (١) البوّابة — قبل أي قراءة
  if ((process.env['ORDERS_ENABLED'] ?? '').trim() !== 'true') return fail('ORDERS_DISABLED')

  // (٢) شكل الطلب — قاطع ورخيص
  if (!isSameOrigin(request.headers, request.nextUrl.host)) return fail('BAD_ORIGIN')

  // JSON بس وبحد MAX_BODY_BYTES: Content-Length المبكر + الفحص الحقيقي بعد القراءة (lib/orders/requestGuards)
  const body = await readJsonBody(request, MAX_BODY_BYTES)
  if (!body.ok) return fail(body.code)
  const payload = body.value

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

  // (٦) الهاشات — كلها سيرفر-سايد، والعميل عمره ما بعت ولا واحد فيهم.
  //     request_hash بيتحسب جوه placeOrder من طلب العميل زي ما وصل، قبل قراية إعداد الموعد (0021-D2 ر٦).
  const receiptSecret = newReceiptSecret()

  let sessionHashHex: string
  let receiptHashHex: string
  try {
    sessionHashHex = await checkoutSessionHash(sessionSecret)
    receiptHashHex = await receiptTokenHash(receiptSecret)
  } catch {
    return fail('INTERNAL')
  }

  // (٧) إعداد الموعد (لو الطلب فيه موعد بس) ← المعاملة الذرّية — lib/orders/placeOrder (0021-D2 §٢-٣).
  //
  // ⚠️ restRpc بترمي لو الـcredentials ناقصة. placeOrder بتمسك الرمي وبترجّع INTERNAL: من غيرها إعداد ناقص
  //    بيطلع صفحة خطأ عامة من Next بدل عقد INTERNAL الثابت، وده بيخرق قاعدة «الرسالة دايماً من جدول §1.3».
  //    وقراية الإعداد بترجّع null عند أي فشل (lib/data/deliverySettings): بموعد = DELIVERY_SETTINGS_UNAVAILABLE
  //    من غير نداء zell_create_order، ومن غير موعد مفيش قراية أصلًا.
  const outcome = await placeOrder(
    parsed.value,
    { idempotencyKey, sessionHashHex, receiptHashHex },
    {
      readDeliverySettings: readCheckoutDeliverySettings,
      createOrder: (args) => restRpc<unknown>('zell_create_order', args),
    },
  )
  if (outcome.kind === 'failure') {
    // الكود والسبب بس — مفيش مفتاح ولا رابط ولا بيانات عميل في اللوج
    console.error('[orders] ' + outcome.code + ' :: ' + outcome.reason)
    return fail(outcome.code)
  }
  const result = outcome.result

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

  // الرد من لقطة الداتابيز كما هي — جديد أو replay، من غير أي إعادة حساب (lib/orders/result)
  const response = NextResponse.json(orderSuccessBody(order), { status: order.replayed ? 200 : 201 })

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
  // الشرط ده بيضمن نداء واحد لكل طلب (الإدخال بينجح مرة واحدة). ومنع
  // الإرسال المكرر لو حصل نداء تاني مسؤوليته **الحجز الذرّي** جوه
  // notifyNewOrder — مش شرط `notified_at is null` في تحديث النجاح، لأن ده
  // بيمنع **التسجيل** المكرر بس.
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
