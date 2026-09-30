import 'server-only'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { authCredentials } from './env'

/** شكل الكوكيز اللي Supabase بيطلب كتابتها. متكتوب صريح لأن
 *  الاستنتاج التلقائي بيفشل مع اتحاد أنواع cookies في @supabase/ssr. */
type CookieToSet = { name: string; value: string; options?: CookieOptions }

/**
 * عميل المصادقة للسيرفر — **بالمفتاح المجهول بس**.
 *
 * ليه مفيش عميل متصفح خالص:
 * تسجيل الدخول Server Action، والكوكيز HttpOnly، فالمتصفح
 * مايشوفش أي مفتاح ولا أي توكن. ومن غير عميل متصفح مفيش داعي
 * لأي NEXT_PUBLIC_.
 *
 * ⚠️ العميل ده **مش** بديل عن lib/data/client.ts. ده للهوية بس،
 * وده للقراءة بصلاحية الخدمة.
 */
export async function createAuthClient(): Promise<SupabaseClient> {
  const { url, anonKey } = authCredentials()
  const store = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const cookie of cookiesToSet) {
            store.set(cookie.name, cookie.value, cookie.options)
          }
        } catch {
          // Server Component مايقدرش يكتب كوكيز.
          // ده متوقع: الـ middleware هو اللي بيجدّد الجلسة.
        }
      },
    },
  })
}
