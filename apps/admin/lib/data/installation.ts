import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/installation.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { orderGovernorates, parseInstallationConfig, parseShippingAreas } from '@zell/core'
import { restGet } from './client'
import type { InstallationConfig } from '@zell/core'

export type InstallationRecord = { config: InstallationConfig; updatedAt: string | null }

/** محافظة من الشحن ومناطقها، بنفس ترتيب صفحة الشحن. */
export type ShippingAreaGroup = { governorate: string; areas: string[]; shippingDisabled: boolean }

export type SettingRow = { key: string; value: unknown }

export const KEY = 'installation'

export async function readShippingAreaGroups(): Promise<ShippingAreaGroup[]> {
  const rows = await restGet<SettingRow>(
    'settings',
    'select=key,value&key=in.(shipping_rates,shipping_order,shipping_areas,shipping_disabled_governorates)',
  )
  const read = (key: string): unknown => rows.rows.find((row) => row.key === key)?.value
  const rates = read('shipping_rates')
  if (typeof rates !== 'object' || rates === null || Array.isArray(rates)) return []
  const savedOrder = read('shipping_order')
  const order = Array.isArray(savedOrder) ? savedOrder.filter((item): item is string => typeof item === 'string') : []
  const disabledRaw = read('shipping_disabled_governorates')
  const disabled = Array.isArray(disabledRaw) ? disabledRaw.filter((item): item is string => typeof item === 'string') : []
  const areas = parseShippingAreas(read('shipping_areas'))
  return orderGovernorates(Object.keys(rates as Record<string, unknown>), order).map((governorate) => ({
    governorate,
    areas: areas[governorate] ?? [],
    shippingDisabled: disabled.includes(governorate),
  }))
}

export async function readInstallationRecord(): Promise<InstallationRecord> {
  const rows = await restGet<{ value: unknown; updated_at: string }>(
    'settings',
    'select=value,updated_at&key=eq.' + KEY + '&limit=1',
  )
  const row = rows.rows[0]
  return { config: parseInstallationConfig(row?.value), updatedAt: row ? row.updated_at : null }
}

export async function readInstallation(): Promise<{ record: InstallationRecord; groups: ShippingAreaGroup[] }> {
  const [record, groups] = await Promise.all([readInstallationRecord(), readShippingAreaGroups()])
  return { record, groups }
}
