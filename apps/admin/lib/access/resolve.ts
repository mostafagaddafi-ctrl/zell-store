/**
 * 0021-P — قرار الوصول لكل وضع (legacy · shadow · enforce). منطق صافي: كل I/O جاي من deps.
 *
 *   legacy  : القرار من admin_users (resolveAdminIdentity) زي النهارده. **مابينادي ولا دالة zell_erp_*** خالص،
 *             لأن أي سطر shadow = «استخدام حقيقي» وبيقفل rollback 0021-P.
 *   shadow  : القرار من legacy زي ما هو. وبيقارن بـ zell_erp_my_access()، ولو فيه اختلاف بيسجّله
 *             (best-effort بحد ١٫٥ ثانية، وفشله مابيوقفش الطلب).
 *   enforce : القرار من zell_erp_my_access(). أي فشل أو شكل رد غلط = unavailable (مقفول).
 *
 * zell_erp_* بتتنادى بجلسة المستخدم بس (anon key + JWT من الكوكي) — ده مسؤولية instance.ts.
 * العقد: docs/contracts/0021-P-code.md §٢ و§٣.
 */

import { isCapability, legacyAdminAllows, type Capability } from './capabilities'
import type { AccessMode } from './mode'

export type AccessRole = 'owner' | 'admin'
export type AccessIdentity = { userId: string; email: string; role: AccessRole }

/** نتيجة admin_users (نفس حالات resolveAdminIdentity). */
export type LegacyOutcome =
  | { state: 'authorized'; identity: AccessIdentity }
  | { state: 'anonymous' }
  | { state: 'forbidden' }
  | { state: 'unavailable' }

export type SessionUser = { state: 'user'; userId: string; email: string } | { state: 'anonymous' } | { state: 'unavailable' }

export type MyAccess = { owner: boolean; active: boolean; capabilities: ReadonlySet<Capability> }

export type ShadowKind = 'legacy_allow_new_deny' | 'legacy_deny_new_allow' | 'new_unavailable'

/** قرار الغلاف: allowed، أو denied (حساب شغال مامعهوش الصلاحية)، أو حالة الهوية. */
export type Authorization =
  | { state: 'allowed'; identity: AccessIdentity }
  | { state: 'denied'; identity: AccessIdentity }
  | { state: 'anonymous' }
  | { state: 'forbidden' }
  | { state: 'unavailable' }

export type ResolveDeps = {
  mode: () => AccessMode
  legacy: () => Promise<LegacyOutcome>
  sessionUser: () => Promise<SessionUser>
  /** الرد الخام من zell_erp_my_access() بجلسة المستخدم. أي error = throw. */
  myAccessRaw: () => Promise<unknown>
  recordShadow: (routeKey: string, capability: Capability, kind: ShadowKind) => Promise<void>
  routeKey: () => Promise<string>
  readTimeoutMs?: number
  shadowTimeoutMs?: number
}

export const READ_TIMEOUT_MS = 3000
export const SHADOW_TIMEOUT_MS = 1500

/** مهلة: لو الوعد ماخلصش في الوقت، بيترمي خطأ. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** فحص شكل رد zell_erp_my_access(): owner و active boolean، و capabilities مصفوفة صلاحيات معروفة. غير كده = null. */
export function parseMyAccess(raw: unknown): MyAccess | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const owner = record['owner']
  const active = record['active']
  const list = record['capabilities']
  if (typeof owner !== 'boolean' || typeof active !== 'boolean' || !Array.isArray(list)) return null
  const capabilities = new Set<Capability>()
  for (const item of list) {
    if (typeof item !== 'string' || !isCapability(item)) return null
    capabilities.add(item)
  }
  return { owner, active, capabilities }
}

function legacyDecision(outcome: LegacyOutcome, capability: Capability | null): Authorization {
  if (outcome.state !== 'authorized') return { state: outcome.state }
  const identity = outcome.identity
  if (capability === null || identity.role === 'owner' || legacyAdminAllows(capability)) return { state: 'allowed', identity }
  return { state: 'denied', identity }
}

async function readMyAccess(deps: ResolveDeps): Promise<MyAccess | null> {
  try {
    return parseMyAccess(await withTimeout(deps.myAccessRaw(), deps.readTimeoutMs ?? READ_TIMEOUT_MS))
  } catch {
    return null
  }
}

async function shadowCompare(deps: ResolveDeps, decision: Authorization, capability: Capability): Promise<void> {
  if (decision.state !== 'allowed' && decision.state !== 'denied') return
  const access = await readMyAccess(deps)
  let kind: ShadowKind | null = null
  if (access === null) kind = 'new_unavailable'
  else {
    const newAllowed = access.active && (access.owner || access.capabilities.has(capability))
    const legacyAllowed = decision.state === 'allowed'
    if (legacyAllowed && !newAllowed) kind = 'legacy_allow_new_deny'
    else if (!legacyAllowed && newAllowed) kind = 'legacy_deny_new_allow'
  }
  if (kind === null) return
  try {
    const key = await deps.routeKey()
    await withTimeout(deps.recordShadow(key, capability, kind), deps.shadowTimeoutMs ?? SHADOW_TIMEOUT_MS)
  } catch {
    // best-effort: فشل التسجيل مابيوقفش الطلب، والقرار من legacy.
  }
}

async function enforceDecision(deps: ResolveDeps, capability: Capability | null): Promise<Authorization> {
  let user: SessionUser
  try {
    user = await withTimeout(deps.sessionUser(), deps.readTimeoutMs ?? READ_TIMEOUT_MS)
  } catch {
    return { state: 'unavailable' }
  }
  if (user.state !== 'user') return { state: user.state }
  const access = await readMyAccess(deps)
  if (access === null) return { state: 'unavailable' }
  if (!access.active) return { state: 'forbidden' }
  const identity: AccessIdentity = { userId: user.userId, email: user.email, role: access.owner ? 'owner' : 'admin' }
  if (capability === null || access.owner || access.capabilities.has(capability)) return { state: 'allowed', identity }
  return { state: 'denied', identity }
}

/** القرار لكل نداء غلاف. capability = null للـ layout (جلسة بس). */
export async function authorize(deps: ResolveDeps, capability: Capability | null): Promise<Authorization> {
  const mode = deps.mode()
  if (mode === 'enforce') return enforceDecision(deps, capability)
  let outcome: LegacyOutcome
  try {
    outcome = await deps.legacy()
  } catch {
    outcome = { state: 'unavailable' }
  }
  const decision = legacyDecision(outcome, capability)
  if (mode === 'shadow' && capability !== null) await shadowCompare(deps, decision, capability)
  return decision
}
