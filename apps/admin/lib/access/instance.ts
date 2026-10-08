import 'server-only'

/**
 * 0021-P — الأغلفة الحقيقية للوحة (ربط lib/access بالجلسة و admin_users و zell_erp_*).
 *
 * ⚠️ (ب1): **مفيش أي page أو action أو route بيستورد الملف ده لسه** — مفيش أثر وقت التشغيل.
 *    التغليف الفعلي في (ب2). العقد: docs/contracts/0021-P-code.md.
 *
 *   • legacy (الافتراضي): resolveAdminIdentity() زي النهارده، ومفيش أي نداء zell_erp_*.
 *   • zell_erp_* بتتنادى بعميل جلسة المستخدم بس (createAuthClient: anon key + كوكيز). ممنوع service_role.
 *   • رفض الصفحات زي requireAdminPage بالظبط، والعلم من guardMutations() نفسها.
 */

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { sanitizeNext } from '../auth/nextPath'
import { resolveAdminIdentity } from '../auth/session'
import { createAuthClient } from '../auth/supabaseServer'
import { guardMutations } from '../mutations'
import type { Capability } from './capabilities'
import { readAccessMode } from './mode'
import { authorize, type LegacyOutcome, type SessionUser, type ShadowKind } from './resolve'
import { createAccessWrappers, type AccessFailure, type PageDenial } from './wrappers'

async function currentPath(): Promise<string> {
  try {
    const store = await headers()
    return store.get('x-admin-path') ?? '/'
  } catch {
    return '/'
  }
}

const legacyOutcome = cache(async (): Promise<LegacyOutcome> => {
  const outcome = await resolveAdminIdentity()
  if (outcome.state !== 'authorized') return { state: outcome.state }
  return { state: 'authorized', identity: { userId: outcome.identity.userId, role: outcome.identity.role } }
})

const sessionUser = cache(async (): Promise<SessionUser> => {
  try {
    const supabase = await createAuthClient()
    const { data, error } = await supabase.auth.getUser()
    if (error !== null || data.user === null) return { state: 'anonymous' }
    return { state: 'user', userId: data.user.id }
  } catch {
    return { state: 'unavailable' }
  }
})

const myAccessRaw = cache(async (): Promise<unknown> => {
  const supabase = await createAuthClient()
  const { data, error } = await supabase.rpc('zell_erp_my_access')
  if (error !== null) throw new Error('zell_erp_my_access failed')
  return data as unknown
})

async function recordShadow(routeKey: string, capability: Capability, kind: ShadowKind): Promise<void> {
  const supabase = await createAuthClient()
  const { error } = await supabase.rpc('zell_erp_record_shadow_event', {
    p_route_key: routeKey.slice(0, 200),
    p_capability: capability,
    p_kind: kind,
  })
  if (error !== null) throw new Error('zell_erp_record_shadow_event failed')
}

async function denyPage(denial: PageDenial): Promise<never> {
  if (denial === 'forbidden') redirect('/403')
  if (denial === 'unavailable') redirect('/login?error=unavailable')
  const target = sanitizeNext(await currentPath())
  redirect(target === '/' ? '/login' : '/login?next=' + encodeURIComponent(target))
}

function denyFormAction(failure: AccessFailure): never {
  redirect(failure.code === 'UNAUTHENTICATED' ? '/login' : '/403')
}

function mutationsGate(): AccessFailure | null {
  const gate = guardMutations()
  if (gate === null || gate.ok) return null
  return { ok: false, code: 'DISABLED', message: gate.message }
}

export const { pageWithAccess, layoutWithSession, routeWithAccess, actionWithAccess, formActionWithAccess } =
  createAccessWrappers({
    authorize: (capability) =>
      authorize(
        {
          mode: () => readAccessMode(process.env['ADMIN_ACCESS_MODE']).mode,
          legacy: legacyOutcome,
          sessionUser,
          myAccessRaw,
          recordShadow,
          routeKey: currentPath,
        },
        capability,
      ),
    mutationsGate,
    denyPage,
    denyFormAction,
  })
