import { NextResponse, type NextRequest } from 'next/server'
import { restRpc } from '../../../../lib/data/rpc'
import { CHECKOUT_SESSION_COOKIE } from '../../../../lib/orders/checkoutSession'
import { handleCouponPreview } from '../../../../lib/orders/couponPreview'

/**
 * POST /api/coupons/preview — معاينة كود الخصم (0019). المنطق والحالات في lib/orders/couponPreview.
 *
 * 🔒 Cache-Control: no-store على كل رد (نجاح وفشل). مفيش كتابة ولا استهلاك استخدام —
 *    zell_preview_coupon بتتنادى من السيرفر بس بمفتاح الخدمة (زي دوال الطلب).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const outcome = await handleCouponPreview(
    {
      request,
      fallbackHost: request.nextUrl.host,
      sessionCookie: request.cookies.get(CHECKOUT_SESSION_COOKIE)?.value,
    },
    {
      ordersEnabled: (process.env['ORDERS_ENABLED'] ?? '').trim() === 'true',
      rpc: (code) => restRpc<unknown>('zell_preview_coupon', { p_code: code }),
      log: (line) => console.error(line),
    },
  )
  return NextResponse.json(outcome.body, { status: outcome.status, headers: { 'Cache-Control': 'no-store' } })
}
