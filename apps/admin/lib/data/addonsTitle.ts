import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/addonsTitle.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { DEFAULT_ADDONS_TITLE } from '@zell/core'
import { restGet } from './client'

/** 0016 — عنوان جزء الإضافات في صفحة المنتج (settings.addons_title). */
export const KEY = 'addons_title'

export async function readAddonsTitle(): Promise<string> {
  const rows = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1')
  const value = rows.rows[0]?.value
  return typeof value === 'string' && value.trim() !== '' ? value : DEFAULT_ADDONS_TITLE
}
