import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/productWidths.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { restGet } from './client'

/**
 * عروض الرول الإضافية لمنتج (0015) — public.product_widths.
 *
 * العرض الأساسي وسعره في المنتج نفسه (products.width_cm / price_per_meter_piastres)
 * وبيتعدّلوا من «السعر والمقاسات». هنا العروض **التانية** بس، كل واحد بسعره.
 * الحفظ استبدال كامل وذرّي عن طريق zell_set_product_widths.
 */
export type AdminWidth = {
  widthCm: number
  pricePerMeterPiastres: number
  compareAtPiastres: number | null
  isActive: boolean
}

export type Row = { width_cm: number; price_per_meter_piastres: number; compare_at_piastres: number | null; is_active: boolean }

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
