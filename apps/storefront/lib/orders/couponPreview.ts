/**
 * POST /api/coupons/preview — المنطق كله هنا (خالص، والـrpc متحقون) عشان يتختبر من غير Next.
 * الراوت نفسه غلاف رفيع: بيدّي الطلب والكوكي والبوّابة و restRpc، وبيرجّع الرد بـno-store.
 *
 * 🔒 ثوابت:
 *   • معاينة تقديرية بس: zell_preview_coupon مابتكتبش ومابتستهلكش استخدام. الحكم النهائي
 *     zell_create_order وقت الطلب.
 *   • الرد شروط camelCase بس من parseCouponPreview الصارم — مفيش id ولا عدّادات ولا تواريخ
 *     ولا ملاحظات ولا مبلغ خصم جاهز.
 *   • الرسالة دايمًا من جدول الأخطاء. رسالة SQL الخام بتتلوج سيرفر-سايد بس لو INTERNAL.
 *   • coupons_enabled = false → COUPONS_DISABLED (الداتابيز بتقرر، 45076).
 */

import { normalizeCouponCode, parseCouponPreview } from '@zell/core'
import type { CouponPreviewErrorCode, CouponPreviewResponse } from './contracts'
import { orderFailure, previewCodeFromSqlError, statusFor } from './errors'
import { isSameOrigin, readJsonBody, type GuardRequest } from './requestGuards'

/** الـbody المتوقع {"code":"..."} — ٥١٢ بايت أكتر من كفاية، والحد بيتفحص بعد القراءة فعلًا. */
export const PREVIEW_MAX_BODY_BYTES = 512

/** نفس شكل RpcResult<unknown> في lib/data/rpc — من غير استيراد ملف server-only. */
export type PreviewRpcResult = { ok: true; data: unknown } | { ok: false; status: number; sqlMessage: string }

export type PreviewInput = {
  request: GuardRequest
  /** request.nextUrl.host — لما هيدر Host يغيب. */
  fallbackHost: string
  /** قيمة كوكي zell_ck الخام (أو undefined). مابتتبعتش لأي مكان — وجودها بس. */
  sessionCookie: string | undefined
}

export type PreviewDeps = {
  ordersEnabled: boolean
  rpc: (code: string) => Promise<PreviewRpcResult>
  log: (line: string) => void
}

export type PreviewOutcome = { status: number; body: CouponPreviewResponse }

function fail(code: CouponPreviewErrorCode): PreviewOutcome {
  return { status: statusFor(code), body: orderFailure(code) }
}

export type PreviewBodyResult = { ok: true; code: string } | { ok: false; code: 'BAD_JSON' | 'COUPON_INVALID' }

/** {"code": string} بالظبط. أي مفتاح زيادة = BAD_JSON. كود فاضي أو مش صالح = COUPON_INVALID. */
export function parsePreviewBody(payload: unknown): PreviewBodyResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return { ok: false, code: 'BAD_JSON' }
  const keys = Object.keys(payload)
  if (keys.length !== 1 || keys[0] !== 'code') return { ok: false, code: 'BAD_JSON' }
  const code = normalizeCouponCode((payload as Record<string, unknown>)['code'])
  return code === null ? { ok: false, code: 'COUPON_INVALID' } : { ok: true, code }
}

export async function handleCouponPreview(input: PreviewInput, deps: PreviewDeps): Promise<PreviewOutcome> {
  // (١) البوّابة — نفس ORDERS_ENABLED بتاعة الطلب، قبل أي قراءة
  if (!deps.ordersEnabled) return fail('ORDERS_DISABLED')

  // (٢) المنشأ والجلسة — نفس فحص راوت الطلب ونفس كوكي zell_ck
  if (!isSameOrigin(input.request.headers, input.fallbackHost)) return fail('BAD_ORIGIN')
  if ((input.sessionCookie ?? '').trim() === '') return fail('CHECKOUT_SESSION_MISSING')

  // (٣) JSON بس وبحد ٥١٢ بايت بعد القراءة
  const body = await readJsonBody(input.request, PREVIEW_MAX_BODY_BYTES)
  if (!body.ok) return fail(body.code)

  // (٤) التطبيع والتحقق قبل أي نداء داتابيز
  const parsed = parsePreviewBody(body.value)
  if (!parsed.ok) return fail(parsed.code)

  // (٥) المعاينة — سيرفر بس
  let result: PreviewRpcResult
  try {
    result = await deps.rpc(parsed.code)
  } catch (error) {
    deps.log('[coupons] INTERNAL :: rpc threw ' + (error instanceof Error ? error.name : 'unknown'))
    return fail('INTERNAL')
  }

  if (!result.ok) {
    const code = previewCodeFromSqlError(result.sqlMessage)
    deps.log('[coupons] ' + code + (code === 'INTERNAL' ? ' :: ' + result.sqlMessage : ''))
    return fail(code)
  }

  // (٦) شكل الرد صارم، والكود الراجع لازم هو نفس اللي اتبعت
  const terms = parseCouponPreview(result.data)
  if (terms === null || terms.code !== parsed.code) {
    deps.log('[coupons] INTERNAL :: unexpected zell_preview_coupon shape')
    return fail('INTERNAL')
  }

  return { status: 200, body: { ok: true, coupon: terms } }
}
