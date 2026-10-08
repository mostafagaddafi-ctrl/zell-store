import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/collections.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import type { AdminCollection } from '../adminData'
import { projectUrl, restGet } from './client'
import { COLLECTION_SELECT, toAdminCollection, type CollectionRow } from './rows'

export const TABLE = 'collections'

/** العدّ الكلي والنشط لمنتجات قسم. */
export async function collectionProductCounts(collectionId: string): Promise<{ total: number; active: number }> {
  const links = await restGet<{ product_id: number }>(
    'product_collections',
    'select=product_id&collection_id=eq.' + encodeURIComponent(collectionId),
  )
  const ids = links.rows.map((row) => row.product_id)
  if (ids.length === 0) return { total: 0, active: 0 }

  const active = await restGet<{ id: number }>(
    'products',
    'select=id&is_active=eq.true&id=in.(' + ids.map((id) => String(id)).join(',') + ')',
  )
  return { total: ids.length, active: active.rows.length }
}

/** القراءة بعد الكتابة — النجاح لازم يعكس الحالة المخزّنة فعلًا. */
export async function readAdminCollection(id: string): Promise<AdminCollection | null> {
  const rows = await restGet<CollectionRow>(
    TABLE,
    'select=' + COLLECTION_SELECT + '&id=eq.' + encodeURIComponent(id) + '&limit=1',
  )
  const row = rows.rows[0]
  if (!row) return null
  return toAdminCollection(row, await collectionProductCounts(id), projectUrl())
}
