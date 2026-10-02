import 'server-only'

import { restGet, restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { flag } from '../validation/shared'
import { toInternalFailure } from './errors'

/**
 * إظهار/إخفاء «نص العرض» (settings.offer_enabled).
 *
 * مفتاح واحد في صف واحد — مش محتاج دالة ذرّية. المفتاح مش موجود =
 * ظاهر (السلوك القديم)، فأول تشغيل بيعمل الصف. النجاح بيتأكد بالقراءة.
 */
export async function setOfferEnabled(rawEnabled: unknown): Promise<MutationResult<{ enabled: boolean }>> {
  const enabled = flag(rawEnabled, 'إظهار نص العرض')
  if (!enabled.ok) return enabled

  try {
    const changed = await restPatch<{ key: string }>('settings', 'key=eq.offer_enabled', {
      value: enabled.value,
      updated_at: new Date().toISOString(),
    })
    if (changed.length === 0) await restInsert('settings', { key: 'offer_enabled', value: enabled.value })

    const stored = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.offer_enabled&limit=1')
    if (stored.rows[0]?.value !== enabled.value) return toInternalFailure(null)
    return { ok: true, data: { enabled: enabled.value } }
  } catch (error) {
    return toInternalFailure(error)
  }
}
