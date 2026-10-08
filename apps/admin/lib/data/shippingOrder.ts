import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/shippingOrder.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { restGet } from './client'

/**
 * ترتيب المحافظات في صفحة الطلب (settings.shipping_order) — عرض بس.
 * مستقل عن الأسعار (zell_save_shipping مابتلمسوش)، فمش محتاج دالة ذرّية.
 */
export const KEY = 'shipping_order'

function asNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

export async function readShippingOrder(): Promise<string[]> {
  const rows = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1')
  return asNames(rows.rows[0]?.value)
}
