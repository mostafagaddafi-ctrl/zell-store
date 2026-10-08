import 'server-only'

import { restRpc } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'
import { readAddonOptions, readProductAddons } from '../data/productAddons'

const MAX_ADDONS = 20

export async function saveProductAddons(productId: unknown, raw: unknown): Promise<MutationResult<number[]>> {
  if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) {
    return { ok: false, code: 'VALIDATION', message: 'المنتج مش صحيح' }
  }
  if (!Array.isArray(raw) || raw.length > MAX_ADDONS) return { ok: false, code: 'VALIDATION', message: 'الإضافات مش صحيحة' }
  const ids: number[] = []
  for (const item of raw as unknown[]) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0 || item === productId) {
      return { ok: false, code: 'VALIDATION', message: 'الإضافات مش صحيحة' }
    }
    if (!ids.includes(item)) ids.push(item)
  }

  try {
    if (ids.length > 0) {
      const pieces = new Set((await readAddonOptions()).map((option) => option.id))
      if (ids.some((id) => !pieces.has(id))) {
        return { ok: false, code: 'VALIDATION', message: 'في إضافة مابقتش منتج بالعدد. اعمل تحديث للصفحة.' }
      }
    }
    await restRpc<number>('zell_set_product_addons', { p_product_id: productId, p_addon_ids: ids })
    const saved = await readProductAddons(productId)
    if (saved.join(',') !== ids.join(',')) return toInternalFailure(null)
    return { ok: true, data: saved }
  } catch (error) {
    return toInternalFailure(error)
  }
}
