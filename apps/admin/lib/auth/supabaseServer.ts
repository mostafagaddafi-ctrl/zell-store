import 'server-only'

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { authCredentials } from './env'

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
      setAll(cookiesToSet) {
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
