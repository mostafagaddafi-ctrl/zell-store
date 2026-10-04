import 'server-only'

import { restGet, restRpc } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'

/**
 * 0016 — إضافات منتج (product_addons) — استبدال ذرّي عن طريق zell_set_product_addons.
 * الإضافة لازم تكون منتج بالقطعة؛ الدالة بترفض غير كده.
 */
export type AddonOption = { id: number; nameAr: string; isActive: boolean; pricePiastres: number }

const MAX_ADDONS = 20

export async function readAddonOptions(): Promise<AddonOption[]> {
  const rows = await restGet<{ id: number; name_ar: string; is_active: boolean; price_per_meter_piastres: number }>(
    'products',
    'select=id,name_ar,is_active,price_per_meter_piastres&sale_unit=eq.piece&order=sort_order.asc,id.asc',
  )
  return rows.rows.map((row) => ({
    id: Number(row.id),
    nameAr: row.name_ar,
    isActive: row.is_active === true,
    pricePiastres: Number(row.price_per_meter_piastres),
  }))
}

export async function readProductAddons(productId: number): Promise<number[]> {
  const rows = await restGet<{ addon_id: number }>(
    'product_addons',
    'select=addon_id&product_id=eq.' + String(productId) + '&order=sort_order.asc',
  )
  return rows.rows.map((row) => Number(row.addon_id))
}

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
