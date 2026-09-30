import 'server-only'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { sanitizeNext } from './nextPath'
import { resolveAdminIdentity, type AdminIdentity } from './session'

/**
 * الحراس.
 *
 * قاعدة: الـ layout **مش** حدود أمان في App Router — الصفحة ممكن
 * تترسم من غير ما الـ layout يعيد التنفيذ. عشان كده كل صفحة محمية
 * بتنادي requireAdminPage بنفسها، وكل Server Action بتنادي
 * requireAdminAction بنفسها.
 *
 * مفيش أي سياق أدمن عام (global/module-scope) — ده كان هيبقى قابل
 * للتزوير من أي نداء. الهوية بتتحسب من الكوكي في كل request.
 */

export type { AdminIdentity, AdminRole } from './session'

export type AdminGuardFailure = {
  ok: false
  code: 'UNAUTHENTICATED' | 'FORBIDDEN'
  message: string
}

const UNAUTHENTICATED_MESSAGE = 'لازم تسجّل دخول الأول.'
const FORBIDDEN_MESSAGE = 'الحساب ده مش مصرّح له بالإجراء ده.'

/** المسار الحالي من هيدر بيحطه الـ middleware. */
async function currentPath(): Promise<string> {
  try {
    const store = await headers()
    return store.get('x-admin-path') ?? '/'
  } catch {
    return '/'
  }
}

/**
 * حارس الصفحات والـ layouts. بيرجع الهوية أو بيعمل redirect.
 * مابيرجعش abstract error — الصفحة إما تتعرض لمصرّح له أو ماتتعرضش.
 */
export async function requireAdminPage(): Promise<AdminIdentity> {
  const outcome = await resolveAdminIdentity()

  if (outcome.state === 'authorized') return outcome.identity
  if (outcome.state === 'forbidden') redirect('/403')
  if (outcome.state === 'unavailable') redirect('/login?error=unavailable')

  const target = sanitizeNext(await currentPath())
  redirect(target === '/' ? '/login' : '/login?next=' + encodeURIComponent(target))
}

/**
 * حارس الـ Server Actions. مابيعملش redirect — بيرجع نتيجة فشل
 * متوافقة مع MutationResult عشان الواجهة تعرضها زي أي فشل تاني.
 */
export async function requireAdminAction(): Promise<{ ok: true; identity: AdminIdentity } | AdminGuardFailure> {
  const outcome = await resolveAdminIdentity()

  if (outcome.state === 'authorized') return { ok: true, identity: outcome.identity }
  if (outcome.state === 'forbidden') return { ok: false, code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }
  return { ok: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGE }
}
