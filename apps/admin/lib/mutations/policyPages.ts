import 'server-only'

import { buildPolicyPages, samePolicyPages } from '@zell/core'
import { savePolicyPagesWith } from '../content/policySave'
import { restInsert } from '../data/client'
import type { MutationResult } from '../mutations'
import { timestamp } from '../validation/shared'
import { CONFLICT_MESSAGE, patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'
import { readPolicyPages, KEY, type PolicyPagesRecord } from '../data/policyPages'

/**
 * POLICY-PAGES — صف واحد settings.policy_pages (docs/contracts/POLICY-PAGES.md §٤).
 *
 * منطق الحفظ نفسه (التزامن التفاؤلي بـ settings.updated_at · الإنشاء المتزامن = CONFLICT · قراءة التأكيد) في
 * lib/content/policySave.ts، علشان يتشغّل في حالات اللوحة (suite policy-save). الملف ده بيحقن عمليات النقل
 * الحقيقية بس. نفس السلوك بالحرف، وبيكتب المفتاح ده بس.
 */
export async function savePolicyPages(raw: unknown, rawExpected: unknown): Promise<MutationResult<PolicyPagesRecord>> {
  return savePolicyPagesWith(
    {
      key: KEY,
      read: readPolicyPages,
      insert: (table, row) => restInsert(table, row),
      patchGuarded: (args) => patchGuarded<{ key: string }>(args),
      build: buildPolicyPages,
      same: samePolicyPages,
      timestamp,
      internalFailure: toInternalFailure,
      conflictMessage: CONFLICT_MESSAGE,
      now: () => new Date().toISOString(),
    },
    raw,
    rawExpected,
  )
}
