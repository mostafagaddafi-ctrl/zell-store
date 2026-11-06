import 'server-only'

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { adminAuthCookieOptions, serverCookieMethods } from './cookieOptions'
import { authCredentials } from './env'

/**
 * عميل المصادقة للسيرفر — **بالمفتاح المجهول بس**.
 *
 * ليه مفيش عميل متصفح خالص:
 * تسجيل الدخول Server Action، فالمتصفح مايشوفش أي مفتاح، ومن غير عميل
 * متصفح مفيش داعي لأي NEXT_PUBLIC_.
 *
 * كوكيز الجلسة HttpOnly وSecure (في الإنتاج) وSameSite=Lax، ومضمونة من الكود: adminAuthCookieOptions()
 * بيتمرّر للمكتبة، وhardenCookieOptions() بيتطبّق على كل كوكي وقت الكتابة (cookieOptions.ts،
 * COOKIES-HEADERS §٢). قبل كده الافتراضي في @supabase/ssr 0.5.2 كان httpOnly: false ومن غير secure.
 *
 * ⚠️ العميل ده **مش** بديل عن lib/data/client.ts. ده للهوية بس،
 * وده للقراءة بصلاحية الخدمة.
 */
export async function createAuthClient(): Promise<SupabaseClient> {
  const { url, anonKey } = authCredentials()
  const store = await cookies()

  return createServerClient(url, anonKey, {
    cookieOptions: adminAuthCookieOptions(),
    cookies: serverCookieMethods(store),
  })
}
