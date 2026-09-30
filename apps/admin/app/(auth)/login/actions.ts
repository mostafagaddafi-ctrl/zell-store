'use server'

import { redirect } from 'next/navigation'
import { sanitizeNext } from '../../../lib/auth/nextPath'
import { readAdminRole } from '../../../lib/auth/session'
import { createAuthClient } from '../../../lib/auth/supabaseServer'

/**
 * تسجيل الدخول — Server Action.
 *
 * خطوتين مش خطوة:
 *   1. signInWithPassword  -> إثبات الهوية
 *   2. admin_users         -> إثبات الصلاحية
 * نجاح الأولى لوحده **مش** إذن دخول. أي حساب في auth.users من غير
 * صف مفعّل في admin_users بيتعمله signOut فورًا.
 *
 * الرسائل موحّدة عن قصد: مفيش فرق بين "بريد مش موجود" و"باسورد غلط"
 * عشان مانديش وسيلة لتعداد الحسابات.
 */

export type LoginState = { error: string | null }

const GENERIC = 'البريد أو كلمة المرور غير صحيحة.'
const NOT_ADMIN = 'الحساب ده مش مصرّح له بالدخول للوحة.'
const UNAVAILABLE = 'خدمة الدخول مش متاحة دلوقتي. جرّب تاني بعد شوية.'

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const emailRaw = formData.get('email')
  const passwordRaw = formData.get('password')
  const nextRaw = formData.get('next')

  const email = typeof emailRaw === 'string' ? emailRaw.trim() : ''
  const password = typeof passwordRaw === 'string' ? passwordRaw : ''
  const next = sanitizeNext(typeof nextRaw === 'string' ? nextRaw : null)

  if (email === '' || password === '') return { error: GENERIC }

  const supabase = await (async () => {
    try {
      return await createAuthClient()
    } catch {
      return null
    }
  })()
  if (supabase === null) return { error: UNAVAILABLE }

  let userId: string
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error !== null || data.user === null) return { error: GENERIC }
    userId = data.user.id
  } catch {
    return { error: UNAVAILABLE }
  }

  let role: string | null
  try {
    role = await readAdminRole(userId)
  } catch {
    await supabase.auth.signOut()
    return { error: UNAVAILABLE }
  }

  if (role === null) {
    // جلسة صالحة بس بلا صلاحية — ماتفضلش مفتوحة
    await supabase.auth.signOut()
    return { error: NOT_ADMIN }
  }

  // برّه أي try: redirect بيرمي NEXT_REDIRECT عن قصد
  redirect(next)
}
