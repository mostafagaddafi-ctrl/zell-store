import 'server-only'

/**
 * POLICY-PAGES — قراية صف settings.policy_pages للمحرر (docs/contracts/POLICY-PAGES.md §٣ و§٤).
 * القيمة الصالحة زي ما هي؛ العنوان أو النص الغايب أو الفاسد = النص الافتراضي كبداية والصفحة مقفولة (readPolicyDrafts).
 */
import { DEFAULT_POLICY_DRAFTS, POLICY_PAGES_SETTING_KEY, readPolicyDrafts, type PolicyPages } from '@zell/core'
import { restGet } from './client'

export type PolicyPagesRecord = { pages: PolicyPages; updatedAt: string | null }

export const KEY = POLICY_PAGES_SETTING_KEY

export async function readPolicyPages(): Promise<PolicyPagesRecord & { stored: PolicyPages | null }> {
  const rows = await restGet<{ value: unknown; updated_at: string }>(
    'settings',
    'select=value,updated_at&key=eq.' + KEY + '&limit=1',
  )
  const row = rows.rows[0]
  const pages = readPolicyDrafts(row?.value, DEFAULT_POLICY_DRAFTS)
  return { pages, updatedAt: row ? row.updated_at : null, stored: row ? pages : null }
}
