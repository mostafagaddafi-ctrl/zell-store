import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { authCredentials } from './env'

/**
 * عميل المصادقة جوه الـ middleware.
 *
 * الـ middleware **مش** حدود الأمان — ده تجديد جلسة وتوجيه مبدئي بس.
 * القرار الحقيقي بيتاخد في requireAdminPage و requireAdminAction.
 *
 * الرد بيتبني من جديد كل ما Supabase يكتب كوكيز، عشان التوكن
 * المجدّد يوصل للمتصفح. عشان كده بنرجّع getResponse() مش الرد نفسه.
 */
export function createMiddlewareClient(
  request: NextRequest,
  requestHeaders: Headers,
): { supabase: SupabaseClient; getResponse: () => NextResponse } {
  const { url, anonKey } = authCredentials()

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value)
        }
        response = NextResponse.next({ request: { headers: requestHeaders } })
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options)
        }
      },
    },
  })

  return { supabase, getResponse: () => response }
}
