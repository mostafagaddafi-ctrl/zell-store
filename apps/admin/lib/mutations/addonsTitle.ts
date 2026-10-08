import 'server-only'

import { restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'
import { readAddonsTitle, KEY } from '../data/addonsTitle'

const MAX_TITLE = 60

export async function saveAddonsTitle(raw: unknown): Promise<MutationResult<string>> {
  const title = typeof raw === 'string' ? raw.trim() : ''
  if (title === '') return { ok: false, code: 'VALIDATION', message: 'اكتب عنوان جزء الإضافات' }
  if (title.length > MAX_TITLE) return { ok: false, code: 'VALIDATION', message: 'العنوان أطول من ' + String(MAX_TITLE) + ' حرف' }
  try {
    const changed = await restPatch<{ key: string }>('settings', 'key=eq.' + KEY, { value: title, updated_at: new Date().toISOString() })
    if (changed.length === 0) await restInsert('settings', { key: KEY, value: title })
    const stored = await readAddonsTitle()
    if (stored !== title) return toInternalFailure(null)
    return { ok: true, data: stored }
  } catch (error) {
    return toInternalFailure(error)
  }
}
