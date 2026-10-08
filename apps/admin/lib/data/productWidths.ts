import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/productWidths.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { restGet } from './client'
import type { AdminWidth, Row } from '../mutations/productWidths'

export async function readProductWidths(productId: number): Promise<AdminWidth[]> {
  const rows = await restGet<Row>(
    'product_widths',
    'select=width_cm,price_per_meter_piastres,compare_at_piastres,is_active&product_id=eq.' +
      String(productId) +
      '&order=sort_order.asc,width_cm.asc',
  )
  return rows.rows.map((row) => ({
    widthCm: Number(row.width_cm),
    pricePerMeterPiastres: Number(row.price_per_meter_piastres),
    compareAtPiastres: typeof row.compare_at_piastres === 'number' ? row.compare_at_piastres : null,
    isActive: row.is_active === true,
  }))
}
