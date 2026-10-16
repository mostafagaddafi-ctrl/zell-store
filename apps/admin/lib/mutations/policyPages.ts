import 'server-only'

import { buildPolicyPages, samePolicyPages } from '@zell/core'
import { restInsert } from '../data/client'
import type { MutationResult } from '../mutations'
import { timestamp } from '../validation/shared'
import { CONFLICT_MESSAGE, patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'
import { readPolicyPages, KEY, type PolicyPagesRecord } from '../data/policyPages'

/**
 * POLICY-PAGES — صف واحد settings.policy_pages (docs/contracts/POLICY-PAGES.md §٤).
 *
 * ⚠️ تزامن تفاؤلي بـ settings.updated_at (نفس شكل installation_tools_page):
 *    صف موجود  → patchGuarded على key بشرط updated_at اللي المحرر شافه؛ حد حفظ بعده = CONFLICT ومفيش كتابة فوقه
 *    مفيش صف   → insert، ولو صف اتعمل في نفس اللحظة = CONFLICT من غير كتابة
 *    وبعدين قراءة تأكيد: المخزّن لازم يساوي المحفوظ بالظبط.
 * ⚠️ بيكتب المفتاح ده بس، فباقي الإعدادات مابتتلمسش. التحقق نفسه في @zell/core (buildPolicyPages).
 */
export async function savePolicyPages(raw: unknown, rawExpected: unknown): Promise<MutationResult<PolicyPagesRecord>> {
  let current: Awaited<ReturnType<typeof readPolicyPages>>
  try {
    current = await readPolicyPages()
  } catch (error) {
    return toInternalFailure(error)
  }

  const built = buildPolicyPages(raw, current.stored, new Date().toISOString())
  if (!built.ok) return built
  const value = built.value

  try {
    if (rawExpected === null) {
      try {
        await restInsert('settings', { key: KEY, value })
      } catch (error) {
        // حد تاني عمل الصف في نفس اللحظة → تعارض حقيقي، مش كتابة فوقه
        const now = await readPolicyPages()
        if (now.updatedAt !== null) return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
        return toInternalFailure(error)
      }
    } else {
      const stamp = timestamp(rawExpected, 'طابع آخر تعديل')
      if (!stamp.ok) return stamp
      const result = await patchGuarded<{ key: string }>({
        table: 'settings',
        idColumn: 'key',
        idValue: KEY,
        expectedUpdatedAt: stamp.value,
        changes: { value },
        select: 'key',
      })
      if (!result.ok) return result
    }

    const stored = await readPolicyPages()
    if (stored.stored === null || !samePolicyPages(stored.pages, value)) return toInternalFailure(null)
    return { ok: true, data: { pages: stored.pages, updatedAt: stored.updatedAt } }
  } catch (error) {
    return toInternalFailure(error)
  }
}
