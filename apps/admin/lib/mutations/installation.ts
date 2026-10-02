import 'server-only'

import { restGet, restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { orderGovernorates } from '@zell/core'
import { toInternalFailure } from './errors'

/**
 * إعداد «فني التركيب» (settings.installation) — بالتواصل، مفيش أسعار هنا.
 *
 *   enabled       الخيار ظاهر في صفحة الطلب ولا لأ
 *   note          السطر اللي بيظهر تحت الزرار (السعر بيبدأ من… وهكذا)
 *   governorates  المحافظات اللي فيها تركيب — فاضية = مش ظاهر في أي حتة
 *
 * صف واحد — مش محتاج دالة ذرّية. النجاح بيتأكد بالقراءة.
 */

export type InstallationSettings = { enabled: boolean; note: string; governorates: string[] }

const KEY = 'installation'
const MAX_NOTE = 300

export function parseInstallation(value: unknown): InstallationSettings {
  const raw = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const governorates = Array.isArray(raw['governorates'])
    ? raw['governorates'].filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
  return {
    enabled: raw['enabled'] === true,
    note: typeof raw['note'] === 'string' ? raw['note'] : '',
    governorates,
  }
}

/** محافظات جدول الشحن بنفس ترتيب صفحة الشحن. */
async function shippingGovernorates(): Promise<string[]> {
  const rows = await restGet<{ key: string; value: unknown }>('settings', 'select=key,value&key=in.(shipping_rates,shipping_order)')
  const rates = rows.rows.find((row) => row.key === 'shipping_rates')?.value
  const saved = rows.rows.find((row) => row.key === 'shipping_order')?.value
  if (typeof rates !== 'object' || rates === null || Array.isArray(rates)) return []
  const order = Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : []
  return orderGovernorates(Object.keys(rates as Record<string, unknown>), order)
}

export async function readInstallation(): Promise<{ settings: InstallationSettings; governorates: string[] }> {
  const [rows, governorates] = await Promise.all([
    restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1'),
    shippingGovernorates(),
  ])
  return { settings: parseInstallation(rows.rows[0]?.value), governorates }
}

export async function saveInstallation(raw: unknown): Promise<MutationResult<InstallationSettings>> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'VALIDATION', message: 'البيانات مش صحيحة' }
  const input = raw as Record<string, unknown>
  if (typeof input['enabled'] !== 'boolean') return { ok: false, code: 'VALIDATION', message: 'مفتاح التشغيل مش صحيح' }
  const note = typeof input['note'] === 'string' ? input['note'].trim() : ''
  if (note.length > MAX_NOTE) return { ok: false, code: 'VALIDATION', message: 'سطر التوضيح أطول من ' + String(MAX_NOTE) + ' حرف' }
  if (!Array.isArray(input['governorates'])) return { ok: false, code: 'VALIDATION', message: 'قايمة المحافظات مش صحيحة' }

  try {
    const known = new Set(await shippingGovernorates())
    const governorates: string[] = []
    for (const item of input['governorates']) {
      if (typeof item !== 'string' || !known.has(item)) {
        return { ok: false, code: 'VALIDATION', message: 'في محافظة مش موجودة في جدول الشحن. اعمل تحديث للصفحة.' }
      }
      if (!governorates.includes(item)) governorates.push(item)
    }

    const value: InstallationSettings = { enabled: input['enabled'], note, governorates }
    const changed = await restPatch<{ key: string }>('settings', 'key=eq.' + KEY, { value, updated_at: new Date().toISOString() })
    if (changed.length === 0) await restInsert('settings', { key: KEY, value })

    const stored = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1')
    const saved = parseInstallation(stored.rows[0]?.value)
    if (saved.enabled !== value.enabled || saved.note !== value.note || saved.governorates.length !== value.governorates.length) {
      return toInternalFailure(null)
    }
    return { ok: true, data: saved }
  } catch (error) {
    return toInternalFailure(error)
  }
}
