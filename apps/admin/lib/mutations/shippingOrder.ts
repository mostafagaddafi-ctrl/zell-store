import 'server-only'

import { restGet, restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'

/**
 * ترتيب المحافظات في صفحة الطلب (settings.shipping_order) — عرض بس.
 * مستقل عن الأسعار (zell_save_shipping مابتلمسوش)، فمش محتاج دالة ذرّية.
 */
const KEY = 'shipping_order'

function asNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

export async function readShippingOrder(): Promise<string[]> {
  const rows = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1')
  return asNames(rows.rows[0]?.value)
}

export async function saveShippingOrder(raw: unknown, known: readonly string[]): Promise<MutationResult<string[]>> {
  if (!Array.isArray(raw) || raw.length > 60) return { ok: false, code: 'VALIDATION', message: 'الترتيب مش صحيح' }
  const allowed = new Set(known)
  const order: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      return { ok: false, code: 'VALIDATION', message: 'في محافظة في الترتيب مش موجودة. اعمل تحديث للصفحة.' }
    }
    if (!order.includes(item)) order.push(item)
  }
  try {
    const changed = await restPatch<{ key: string }>('settings', 'key=eq.' + KEY, { value: order, updated_at: new Date().toISOString() })
    if (changed.length === 0) await restInsert('settings', { key: KEY, value: order })
    const stored = await readShippingOrder()
    if (stored.join('|') !== order.join('|')) return toInternalFailure(null)
    return { ok: true, data: stored }
  } catch (error) {
    return toInternalFailure(error)
  }
}
