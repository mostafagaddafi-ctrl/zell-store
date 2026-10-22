/**
 * POLICY-PAGES — منطق حفظ صف settings.policy_pages (docs/contracts/POLICY-PAGES.md §٤) — منطق خالص.
 *
 * ده نفس منطق savePolicyPages اللي كان جوه lib/mutations/policyPages.ts بالحرف، اتنقل هنا من غير أي تغيير
 * في السلوك علشان يتشغّل في حالات اللوحة (suite policy-save — B1 في مراجعة #166–#169). الغلاف
 * lib/mutations/policyPages.ts (server-only) هو اللي بيحقن عمليات النقل الحقيقية: القراية (readPolicyPages) ·
 * restInsert · الحارس المشترك patchGuarded · buildPolicyPages وsamePolicyPages · timestamp · toInternalFailure ·
 * CONFLICT_MESSAGE · الوقت. الملف ده مايستوردش أي قيمة من برّه المجلد (الأنواع بس).
 *
 * ⚠️ تزامن تفاؤلي بـ settings.updated_at (نفس شكل installation_tools_page):
 *    صف موجود  → patchGuarded على key بشرط updated_at اللي المحرر شافه؛ حد حفظ بعده = CONFLICT ومفيش كتابة فوقه
 *    مفيش صف   → insert، ولو صف اتعمل في نفس اللحظة = CONFLICT من غير كتابة
 *    وبعدين قراءة تأكيد: المخزّن لازم يساوي المحفوظ بالظبط.
 * ⚠️ بيكتب المفتاح ده بس، فباقي الإعدادات مابتتلمسش. التحقق نفسه في @zell/core (buildPolicyPages).
 */
import type { PolicyBuildResult, PolicyPages } from '@zell/core'
import type { PolicyPagesRecord } from '../data/policyPages'
import type { MutationResult } from '../mutations'
import type { GuardFailure } from '../mutations/concurrency'
import type { Validated } from '../validation/shared'

/** نتيجة القراية: الصف زي ما المحرر بيشوفه، وstored = null لو مفيش صف. */
export type PolicyPagesRead = PolicyPagesRecord & { stored: PolicyPages | null }

/** معاملات الكتابة المحمية اللي بتتبعت للحارس patchGuarded. */
export type PolicyGuardedPatch = {
  table: 'settings'
  idColumn: 'key'
  idValue: string
  expectedUpdatedAt: string
  changes: { value: PolicyPages }
  select: 'key'
}

/** عمليات النقل والتحقق المحقونة — الغلاف بيبعت الحقيقية، والحالات بتبعت بدايل بتسجّل. */
export type PolicySaveDeps = {
  /** مفتاح الصف — الغلاف بيبعت POLICY_PAGES_SETTING_KEY. */
  key: string
  read: () => Promise<PolicyPagesRead>
  insert: (table: 'settings', row: { key: string; value: PolicyPages }) => Promise<unknown>
  patchGuarded: (args: PolicyGuardedPatch) => Promise<{ ok: true } | GuardFailure>
  build: (raw: unknown, stored: PolicyPages | null, nowIso: string) => PolicyBuildResult
  same: (a: PolicyPages, b: PolicyPages) => boolean
  timestamp: (value: unknown, label: string) => Validated<string>
  internalFailure: (error: unknown) => MutationResult<never>
  conflictMessage: string
  now: () => string
}

export async function savePolicyPagesWith(
  deps: PolicySaveDeps,
  raw: unknown,
  rawExpected: unknown,
): Promise<MutationResult<PolicyPagesRecord>> {
  let current: PolicyPagesRead
  try {
    current = await deps.read()
  } catch (error) {
    return deps.internalFailure(error)
  }

  const built = deps.build(raw, current.stored, deps.now())
  if (!built.ok) return built
  const value = built.value

  try {
    if (rawExpected === null) {
      try {
        await deps.insert('settings', { key: deps.key, value })
      } catch (error) {
        // حد تاني عمل الصف في نفس اللحظة → تعارض حقيقي، مش كتابة فوقه
        const now = await deps.read()
        if (now.updatedAt !== null) return { ok: false, code: 'CONFLICT', message: deps.conflictMessage }
        return deps.internalFailure(error)
      }
    } else {
      const stamp = deps.timestamp(rawExpected, 'طابع آخر تعديل')
      if (!stamp.ok) return stamp
      const result = await deps.patchGuarded({
        table: 'settings',
        idColumn: 'key',
        idValue: deps.key,
        expectedUpdatedAt: stamp.value,
        changes: { value },
        select: 'key',
      })
      if (!result.ok) return result
    }

    const stored = await deps.read()
    if (stored.stored === null || !deps.same(stored.pages, value)) return deps.internalFailure(null)
    return { ok: true, data: { pages: stored.pages, updatedAt: stored.updatedAt } }
  } catch (error) {
    return deps.internalFailure(error)
  }
}
