import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/homeProducts.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { parseHomeProducts, type HomeProducts } from '@zell/core'
import { restGet } from './client'

export type HomeProductOption = { id: number; nameAr: string; isActive: boolean }

/**
 * «الصفحة الرئيسية» (settings.home_products):
 *   mode      all · selected · none — إيه اللي يظهر في جزء المنتجات في الرئيسية
 *   ids       المنتجات المختارة (لما mode = selected)
 *   allLabel  اسم رابط «كل المنتجات» في القائمة — فاضي = مخفي
 */
export const KEY = 'home_products'

export async function readHomeProducts(): Promise<{ settings: HomeProducts; products: HomeProductOption[] }> {
  const [rows, products] = await Promise.all([
    restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1'),
    restGet<{ id: number; name_ar: string; is_active: boolean }>('products', 'select=id,name_ar,is_active&order=sort_order.asc,id.asc'),
  ])
  return {
    settings: parseHomeProducts(rows.rows[0]?.value),
    products: products.rows.map((row) => ({ id: Number(row.id), nameAr: row.name_ar, isActive: row.is_active })),
  }
}
