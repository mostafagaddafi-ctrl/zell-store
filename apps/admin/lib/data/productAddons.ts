import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/productAddons.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { restGet } from './client'
import type { AddonOption } from '../mutations/productAddons'

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
