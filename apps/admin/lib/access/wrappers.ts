/**
 * 0021-P — الأغلفة المحمية (منطق صافي، من غير I/O). نفس شكل الـ Spike (8260b53).
 *
 * كل page / layout / route method / Server Action بيتصدّر كنتيجة نداء غلاف بصلاحية مكتوبة نصًا.
 * الترتيب جوه الغلاف ثابت: الهوية ← الصلاحية ← علم التعديلات (لو mutates) ← الدالة.
 *
 * نتايج الفشل نفس النهارده بالظبط (requireAdminAction / requireAdminPage / guardMutations):
 *   anonymous و unavailable  -> UNAUTHENTICATED «لازم تسجّل دخول الأول.»
 *   forbidden (مالوش صف)     -> FORBIDDEN «الحساب ده مش مصرّح له بالإجراء ده.»
 *   denied (مامعهوش الصلاحية) -> FORBIDDEN بنفس الرسالة، أو options.forbiddenMessage
 *                               (الكوبونات والمخزون ليهم رسالة «للمالك بس» بتاعتهم)
 *   denied على zell.unimplemented -> FORBIDDEN «العملية غير متاحة حاليًا.» بالحرف
 *   mutates + العلم مقفول     -> نتيجة guardMutations() نفسها (DISABLED)
 *
 * العقد: docs/contracts/0021-P-code.md §٥ و§٧.
 */

import type { ReactNode } from 'react'
import { UNIMPLEMENTED_CAPABILITY, type Capability } from './capabilities'
import type { AccessIdentity, Authorization } from './resolve'

export type AccessContext = { identity: AccessIdentity }

export type AccessFailureCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'DISABLED'
export type AccessFailure = { ok: false; code: AccessFailureCode; message: string }

export type PageDenial = 'anonymous' | 'forbidden' | 'unavailable'

export const UNAUTHENTICATED_MESSAGE = 'لازم تسجّل دخول الأول.'
export const FORBIDDEN_MESSAGE = 'الحساب ده مش مصرّح له بالإجراء ده.'
export const UNIMPLEMENTED_MESSAGE = 'العملية غير متاحة حاليًا.'

export const ACCESS_HTTP_STATUS: Record<AccessFailureCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  DISABLED: 409,
}

export type AccessDeps = {
  authorize: (capability: Capability | null) => Promise<Authorization>
  /** null = التعديلات مفتوحة. غير كده = نتيجة الفشل بالظبط (guardMutations()). */
  mutationsGate: () => AccessFailure | null
  denyPage: (denial: PageDenial) => never | Promise<never>
  denyFormAction: (failure: AccessFailure) => never
}

export type ActionOptions<R = never> = {
  mutates: boolean
  /** رسالة FORBIDDEN لما الحساب مامعهوش الصلاحية (بدل الرسالة العامة). */
  forbiddenMessage?: string
  /** تحويل الفشل لشكل نتيجة الأكشن (مثلًا InventoryFailure). من غيره بيرجع AccessFailure زي ما هو. */
  mapFailure?: (failure: AccessFailure) => R
}

type Decision = { ok: true; ctx: AccessContext } | { ok: false; failure: AccessFailure; page: PageDenial }

function failure(code: AccessFailureCode, message: string): AccessFailure {
  return { ok: false, code, message }
}

async function decide(deps: AccessDeps, capability: Capability | null, forbiddenMessage: string | undefined): Promise<Decision> {
  let auth: Authorization
  try {
    auth = await deps.authorize(capability)
  } catch {
    auth = { state: 'unavailable' }
  }
  switch (auth.state) {
    case 'allowed':
      return { ok: true, ctx: { identity: auth.identity } }
    case 'anonymous':
      return { ok: false, failure: failure('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE), page: 'anonymous' }
    case 'unavailable':
      return { ok: false, failure: failure('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE), page: 'unavailable' }
    case 'forbidden':
      return { ok: false, failure: failure('FORBIDDEN', FORBIDDEN_MESSAGE), page: 'forbidden' }
    case 'denied': {
      const message = capability === UNIMPLEMENTED_CAPABILITY ? UNIMPLEMENTED_MESSAGE : forbiddenMessage ?? FORBIDDEN_MESSAGE
      return { ok: false, failure: failure('FORBIDDEN', message), page: 'forbidden' }
    }
  }
}

export function createAccessWrappers(deps: AccessDeps) {
  function pageWithAccess<P extends object>(
    capability: Capability,
    render: (ctx: AccessContext, props: P) => ReactNode | Promise<ReactNode>,
  ): (props: P) => Promise<ReactNode> {
    return async function GuardedPage(props: P): Promise<ReactNode> {
      const decision = await decide(deps, capability, undefined)
      if (!decision.ok) return deps.denyPage(decision.page)
      return render(decision.ctx, props)
    }
  }

  function layoutWithSession<P extends { children: ReactNode }>(
    render: (ctx: AccessContext, props: P) => ReactNode | Promise<ReactNode>,
  ): (props: P) => Promise<ReactNode> {
    return async function GuardedLayout(props: P): Promise<ReactNode> {
      const decision = await decide(deps, null, undefined)
      if (!decision.ok) return deps.denyPage(decision.page)
      return render(decision.ctx, props)
    }
  }

  function routeWithAccess<A extends [Request, ...unknown[]]>(
    capability: Capability,
    options: { mutates: boolean; forbiddenMessage?: string },
    handler: (ctx: AccessContext, ...args: A) => Promise<Response>,
  ): (...args: A) => Promise<Response> {
    return async function GuardedRoute(...args: A): Promise<Response> {
      const decision = await decide(deps, capability, options.forbiddenMessage)
      if (!decision.ok) return Response.json(decision.failure, { status: ACCESS_HTTP_STATUS[decision.failure.code] })
      if (options.mutates) {
        const gate = deps.mutationsGate()
        if (gate !== null) return Response.json(gate, { status: ACCESS_HTTP_STATUS.DISABLED })
      }
      return handler(decision.ctx, ...args)
    }
  }

  function actionWithAccess<A extends unknown[], R, F = AccessFailure>(
    capability: Capability,
    options: ActionOptions<F>,
    fn: (ctx: AccessContext, ...args: A) => Promise<R>,
  ): (...args: A) => Promise<R | F> {
    const mapFailure = (value: AccessFailure): F => (options.mapFailure ? options.mapFailure(value) : (value as unknown as F))
    return async function GuardedAction(...args: A): Promise<R | F> {
      const decision = await decide(deps, capability, options.forbiddenMessage)
      if (!decision.ok) return mapFailure(decision.failure)
      if (options.mutates) {
        const gate = deps.mutationsGate()
        if (gate !== null) return mapFailure(gate)
      }
      return fn(decision.ctx, ...args)
    }
  }

  function formActionWithAccess(
    capability: Capability,
    options: { mutates: boolean; forbiddenMessage?: string },
    fn: (ctx: AccessContext, formData: FormData) => Promise<void>,
  ): (formData: FormData) => Promise<void> {
    return async function GuardedFormAction(formData: FormData): Promise<void> {
      const decision = await decide(deps, capability, options.forbiddenMessage)
      if (!decision.ok) return deps.denyFormAction(decision.failure)
      if (options.mutates) {
        const gate = deps.mutationsGate()
        if (gate !== null) return deps.denyFormAction(gate)
      }
      return fn(decision.ctx, formData)
    }
  }

  return { pageWithAccess, layoutWithSession, routeWithAccess, actionWithAccess, formActionWithAccess }
}
