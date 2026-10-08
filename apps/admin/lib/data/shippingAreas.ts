import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/shippingAreas.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { parseShippingAreas } from '@zell/core'
import { restGet } from './client'
import type { Areas } from '../mutations/shippingAreas'

/**
 * مناطق كل محافظة (settings.shipping_areas) — اختيار سريع للزبون في صفحة الطلب.
 * عرض بس: سعر الشحن بالمحافظة زي ما هو، والمنطقة بتتكتب أول العنوان.
 * صف واحد مستقل عن الأسعار — مش محتاج دالة ذرّية. النجاح بيتأكد بالقراءة.
 */
export const KEY = 'shipping_areas'

export async function readShippingAreas(): Promise<Areas> {
  const rows = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1')
  return parseShippingAreas(rows.rows[0]?.value)
}
