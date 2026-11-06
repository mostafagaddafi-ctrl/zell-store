import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { adminAuthCookieOptions, hardenCookieOptions, type CookieToSet } from './cookieOptions'
import { authCredentials } from './env'

/**
 * عميل المصادقة جوه الـ middleware.
 *
 * الـ middleware **مش** حدود الأمان — ده تجديد جلسة وتوجيه مبدئي بس.
 * القرار الحقيقي بيتاخد في requireAdminPage و requireAdminAction.
 *
 * الرد بيتبني من جديد كل ما Supabase يكتب كوكيز، عشان التوكن
 * المجدّد يوصل للمتصفح. عشان كده بنرجّع getResponse() مش الرد نفسه.
 *
 * الكوكيز HttpOnly وSecure (في الإنتاج) وSameSite=Lax: cookieOptions.ts (COOKIES-HEADERS §٢).
 */
export function createMiddlewareClient(
  request: NextRequest,
  requestHeaders: Headers,
): { supabase: SupabaseClient; getResponse: () => NextResponse } {
  const { url, anonKey } = authCredentials()

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(url, anonKey, {
    cookieOptions: adminAuthCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value)
        }
        response = NextResponse.next({ request: { headers: requestHeaders } })
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, hardenCookieOptions(cookie.options))
        }
      },
    },
  })

  return { supabase, getResponse: () => response }
}

/**
 * نقل كوكيز الجلسة المجدّدة على رد التوجيه، وإلا التجديد بيضيع.
 * اتنقلت من middleware.ts من غير تغيير، عشان cookies.cases.ts يختبرها (COOKIES-HEADERS §٣ C5).
 */
export function redirectWithCookies(target: URL, carrier: NextResponse | null): NextResponse {
  const redirectResponse = NextResponse.redirect(target)
  if (carrier) {
    for (const cookie of carrier.cookies.getAll()) {
      redirectResponse.cookies.set(cookie)
    }
  }
  return redirectResponse
}
