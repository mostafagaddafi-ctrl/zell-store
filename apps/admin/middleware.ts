import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from './lib/auth/supabaseMiddleware'

/**
 * تجديد الجلسة + توجيه مبدئي.
 *
 * ⚠️ الملف ده **مش** حدود الأمان. أي مسار محمي لازم ينادي
 * requireAdminPage، وأي Server Action لازم تنادي requireAdminAction.
 * الغرض هنا: تجديد التوكن قبل ما يوصل للسيرفر، وتوجيه لطيف بدل
 * صفحة فاضية.
 */

const PUBLIC_PATHS = new Set(['/login', '/403'])

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  return pathname.startsWith('/auth/')
}

/** نقل كوكيز الجلسة المجدّدة على رد التوجيه، وإلا التجديد بيضيع. */
function redirectWithCookies(target: URL, carrier: NextResponse | null): NextResponse {
  const redirectResponse = NextResponse.redirect(target)
  if (carrier) {
    for (const cookie of carrier.cookies.getAll()) {
      redirectResponse.cookies.set(cookie)
    }
  }
  return redirectResponse
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-admin-path', pathname + search)

  let supabase
  let getResponse: () => NextResponse
  try {
    const client = createMiddlewareClient(request, requestHeaders)
    supabase = client.supabase
    getResponse = client.getResponse
  } catch {
    // مفاتيح ناقصة. المسارات العامة بتعدّي عشان صفحة الدخول
    // تعرض الخطأ بوضوح؛ المحمي بيتوجّه لنفس الرسالة.
    if (isPublic(pathname)) return NextResponse.next({ request: { headers: requestHeaders } })
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = '?error=unavailable'
    return NextResponse.redirect(url)
  }

  let signedIn = false
  try {
    const { data } = await supabase.auth.getUser()
    signedIn = data.user !== null
  } catch {
    signedIn = false
  }

  if (!signedIn && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    const target = pathname + search
    if (target !== '/') url.searchParams.set('next', target)
    return redirectWithCookies(url, getResponse())
  }

  if (signedIn && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return redirectWithCookies(url, getResponse())
  }

  return getResponse()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)',
  ],
}
