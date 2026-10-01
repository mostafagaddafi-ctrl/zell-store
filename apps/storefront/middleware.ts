import { NextResponse, type NextRequest } from 'next/server'
import {
  CHECKOUT_SESSION_COOKIE,
  CHECKOUT_SESSION_MAX_AGE_SECONDS,
  newCheckoutSessionSecret,
} from './lib/orders/checkoutSession'

/**
 * إصدار كوكي جلسة الدفع — ORDER-FLOW-PLAN.md §4.5 (ب١٠).
 *
 * بيتصدر على /checkout **قبل أول submit**، فالراوت يقدر يتحقق إن الـreplay
 * جاي من **نفس المتصفح**. من غير الكوكي دي، حامل Idempotency-Key + نفس الـbody
 * كان يقدر يصدر وصول للإيصال — وده اللي ب١٠ قفلته.
 *
 * ⚠️ الكوكي HttpOnly فـJavaScript ما بتشوفهاش، والسر الخام عمره ما يدخل أي
 *    رد JSON ولا أي URL.
 */
export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next()

  const existing = request.cookies.get(CHECKOUT_SESSION_COOKIE)
  if (existing === undefined || existing.value.trim() === '') {
    response.cookies.set({
      name: CHECKOUT_SESSION_COOKIE,
      value: newCheckoutSessionSecret(),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: CHECKOUT_SESSION_MAX_AGE_SECONDS,
    })
  }

  return response
}

export const config = {
  matcher: ['/checkout'],
}
