import 'server-only'

import { parseShippingAreas } from '@zell/core'
import { restGet, restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'

/**
 * مناطق كل محافظة (settings.shipping_areas) — اختيار سريع للزبون في صفحة الطلب.
 * عرض بس: سعر الشحن بالمحافظة زي ما هو، والمنطقة بتتكتب أول العنوان.
 * صف واحد مستقل عن الأسعار — مش محتاج دالة ذرّية. النجاح بيتأكد بالقراءة.
 */
const KEY = 'shipping_areas'
const MAX_AREAS = 40
const MAX_AREA_LENGTH = 40

type Areas = Record<string, string[]>

export async function readShippingAreas(): Promise<Areas> {
  const rows = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1')
  return parseShippingAreas(rows.rows[0]?.value)
}

/** jsonb بيعيد ترتيب المفاتيح — فالمقارنة بالمحتوى مش بالنص. */
function sameAreas(a: Areas, b: Areas): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => (a[key] ?? []).join('|') === (b[key] ?? []).join('|'))
}

export async function saveShippingAreas(raw: unknown, known: readonly string[]): Promise<MutationResult<Areas>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'VALIDATION', message: 'المناطق مش صحيحة' }
  }
  const allowed = new Set(known)
  const value: Areas = {}
  for (const [governorate, list] of Object.entries(raw as Record<string, unknown>)) {
    // محافظة اتمسحت من الشحن — مناطقها بتتشال معاها
    if (!allowed.has(governorate)) continue
    if (!Array.isArray(list)) return { ok: false, code: 'VALIDATION', message: 'مناطق ' + governorate + ' مش صحيحة' }
    const names: string[] = []
    for (const item of list as unknown[]) {
      if (typeof item !== 'string') return { ok: false, code: 'VALIDATION', message: 'مناطق ' + governorate + ' مش صحيحة' }
      const name = item.trim()
      if (name === '') continue
      if (name.length > MAX_AREA_LENGTH) {
        return { ok: false, code: 'VALIDATION', message: 'اسم منطقة أطول من ' + String(MAX_AREA_LENGTH) + ' حرف في ' + governorate }
      }
      if (!names.includes(name)) names.push(name)
    }
    if (names.length > MAX_AREAS) {
      return { ok: false, code: 'VALIDATION', message: 'أقصى عدد مناطق للمحافظة ' + String(MAX_AREAS) }
    }
    if (names.length > 0) value[governorate] = names
  }

  try {
    const changed = await restPatch<{ key: string }>('settings', 'key=eq.' + KEY, { value, updated_at: new Date().toISOString() })
    if (changed.length === 0) await restInsert('settings', { key: KEY, value })
    const stored = await readShippingAreas()
    if (!sameAreas(stored, value)) return toInternalFailure(null)
    return { ok: true, data: stored }
  } catch (error) {
    return toInternalFailure(error)
  }
}
