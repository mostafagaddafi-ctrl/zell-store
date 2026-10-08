import 'server-only'

import { restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'
import { readShippingOrder, KEY } from '../data/shippingOrder'

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
