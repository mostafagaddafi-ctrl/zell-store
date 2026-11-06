import type { CookieOptions, CookieOptionsWithName } from '@supabase/ssr'

/**
 * COOKIES-HEADERS §٢ — خيارات كوكيز جلسة اللوحة.
 *
 * الملف ده **مالوش** server-only ولا next/headers عن قصد: الـ middleware (Edge) وعميل السيرفر بيستوردوه،
 * وحالات cookies.cases.ts بتشغّله.
 *
 * @supabase/ssr 0.5.2 افتراضيها httpOnly: false ومن غير secure (src/utils/constants.ts). هنا:
 * - adminAuthCookieOptions() بيتمرّر للمكتبة بـ cookieOptions. **من غير name** (اسم الكوكي ومفتاح التخزين
 *   مايتغيّروش) و**من غير maxAge** (المدة تفضل افتراضي المكتبة 400 يوم، والحذف بـ maxAge: 0 من المكتبة).
 * - hardenCookieOptions() بيتطبّق على كل كوكي وقت الكتابة، حماية زيادة لو نسخة مكتبة جاية غيّرت الدمج:
 *   httpOnly وsecure وsameSite بس؛ الاسم والقيمة والمسار والمدة زي ما المكتبة بعتتهم.
 * secure = الإنتاج بس (زي كوكيز المتجر)، عشان التطوير على http://localhost يشتغل.
 */

export type CookieToSet = { name: string; value: string; options?: CookieOptions }

function isProduction(env: string | undefined): boolean {
  return env === 'production'
}

export function adminAuthCookieOptions(env: string | undefined = process.env.NODE_ENV): CookieOptionsWithName {
  return { httpOnly: true, secure: isProduction(env), sameSite: 'lax', path: '/' }
}

export function hardenCookieOptions(options: CookieOptions | undefined, env: string | undefined = process.env.NODE_ENV): CookieOptions {
  return { ...options, httpOnly: true, secure: isProduction(env), sameSite: 'lax' }
}

/** الجزء من cookies() (next/headers) اللي عميل السيرفر بيحتاجه. */
export type ServerCookieStore = {
  getAll(): { name: string; value: string }[]
  set(name: string, value: string, options?: CookieOptions): unknown
}

/** كوكيز عميل السيرفر (createAuthClient في supabaseServer.ts). */
export function serverCookieMethods(store: ServerCookieStore) {
  return {
    getAll() {
      return store.getAll()
    },
    setAll(cookiesToSet: CookieToSet[]) {
      try {
        for (const cookie of cookiesToSet) {
          store.set(cookie.name, cookie.value, hardenCookieOptions(cookie.options))
        }
      } catch {
        // Server Component مايقدرش يكتب كوكيز.
        // ده متوقع: الـ middleware هو اللي بيجدّد الجلسة.
      }
    },
  }
}
