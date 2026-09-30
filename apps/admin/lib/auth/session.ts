import 'server-only'

import { cache } from 'react'
import { restGet } from '../data/client'
import { createAuthClient } from './supabaseServer'

/**
 * مصدر الحقيقة الوحيد للهوية والدور.
 *
 * البريد بييجي من auth.users عن طريق getUser() — **مش** مكرر في
 * admin_users، عشان مايحصلش اختلاف بين الاتنين.
 * الدور بييجي من admin_users بصلاحية الخدمة، لأن RLS مقفول
 * والجدول مالهوش أي policy و anon/authenticated مالهمش SELECT.
 *
 * getUser() بس — مفيش getSession() في أي قرار صلاحية. getSession
 * بيقرا الكوكي من غير تحقق من السيرفر، يعني قابل للتزوير.
 *
 * cache() بتخلي كل ده نداء واحد لكل request مهما اتنادى كام مرة.
 */

export type AdminRole = 'owner' | 'admin'
export type AdminIdentity = { userId: string; email: string; role: AdminRole }

export type AuthOutcome =
  | { state: 'authorized'; identity: AdminIdentity }
  | { state: 'anonymous' }
  | { state: 'forbidden' }
  | { state: 'unavailable' }

type AdminUserRow = { user_id: string; role: string; is_active: boolean }

function isAdminRole(value: string): value is AdminRole {
  return value === 'owner' || value === 'admin'
}

/** قراءة صف الصلاحية. بيرجع null لو مفيش صف أو الحساب موقوف. */
export async function readAdminRole(userId: string): Promise<AdminRole | null> {
  const { rows } = await restGet<AdminUserRow>(
    'admin_users',
    'select=user_id,role,is_active&user_id=eq.' + encodeURIComponent(userId) + '&limit=1',
  )
  const row = rows[0]
  if (!row) return null
  if (!row.is_active) return null
  if (!isAdminRole(row.role)) return null
  return row.role
}

export const resolveAdminIdentity = cache(async (): Promise<AuthOutcome> => {
  let userId: string
  let email: string

  try {
    const supabase = await createAuthClient()
    const { data, error } = await supabase.auth.getUser()
    if (error !== null || data.user === null) return { state: 'anonymous' }
    userId = data.user.id
    email = data.user.email ?? ''
  } catch {
    // إعدادات ناقصة أو الشبكة وقعت — الفشل الصريح أأمن من المرور
    return { state: 'unavailable' }
  }

  try {
    const role = await readAdminRole(userId)
    if (role === null) return { state: 'forbidden' }
    return { state: 'authorized', identity: { userId, email, role } }
  } catch {
    return { state: 'unavailable' }
  }
})
