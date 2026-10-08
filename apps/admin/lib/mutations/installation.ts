import 'server-only'

import {
  INSTALLATION_LIMITS,
  installationGovernorates,
  isInstallationMoney,
  type InstallationAreas,
  type InstallationConfig,
} from '@zell/core'
import { restInsert } from '../data/client'
import type { MutationResult } from '../mutations'
import { timestamp } from '../validation/shared'
import { CONFLICT_MESSAGE, patchGuarded } from './concurrency'
import { toInternalFailure } from './errors'
import { readShippingAreaGroups, readInstallationRecord, KEY } from '../data/installation'

/**
 * فني التركيب — settings.installation (0018).
 *
 *   enabled              تشغيل الخدمة
 *   note                 سطر توضيح تحت خيار الفني في صفحة الطلب
 *   feePerMeterPiastres  أجر التركيب لكل متر طولي من أفلام المقاس (1..1,000,000 قرش)
 *   areas                { محافظة: { منطقة: انتقال الفني بالقرش (0..1,000,000) } }
 *   governorates         مشتق من areas — للنسخة الحالية من المتجر بس
 *
 * ⚠️ أسماء المحافظات والمناطق من إعدادات الشحن بس (shipping_rates + shipping_areas).
 *    السيرفر بيرفض أي منطقة مش موجودة هناك — مفيش كتابة أسماء بإيد.
 * ⚠️ تزامن تفاؤلي بـ settings.updated_at (patchGuarded) + قراءة تأكيد.
 *    الحساب نفسه في zell_create_order — هنا إعداد بس.
 */

export type InstallationRecord = { config: InstallationConfig; updatedAt: string | null }

export type InstallationInput = {
  enabled: boolean
  note: string
  feePerMeterPiastres: number | null
  areas: InstallationAreas
}

/** محافظة من الشحن ومناطقها، بنفس ترتيب صفحة الشحن. */
export type ShippingAreaGroup = { governorate: string; areas: string[]; shippingDisabled: boolean }

/** منطقة متحفظة للفني ومش موجودة في الشحن (اتشالت أو اتغير اسمها). */
export type OrphanArea = { governorate: string; area: string }

export type SettingRow = { key: string; value: unknown }

/** المناطق المفعّلة للفني اللي مش في مناطق الشحن. */
export function orphanAreas(areas: InstallationAreas, groups: ShippingAreaGroup[]): OrphanArea[] {
  const shipping = new Map(groups.map((group) => [group.governorate, group.areas]))
  const out: OrphanArea[] = []
  for (const [governorate, list] of Object.entries(areas)) {
    const known = shipping.get(governorate) ?? []
    for (const area of Object.keys(list)) if (!known.includes(area)) out.push({ governorate, area })
  }
  return out
}

/** بعد حفظ الشحن: مناطق الفني اللي مابقتش موجودة في الشحن. */
export async function installerAreasMissingFromShipping(): Promise<OrphanArea[]> {
  const [record, groups] = await Promise.all([readInstallationRecord(), readShippingAreaGroups()])
  return orphanAreas(record.config.areas, groups)
}

function sameConfig(a: InstallationConfig, b: InstallationConfig): boolean {
  if (a.enabled !== b.enabled || a.note !== b.note || a.feePerMeterPiastres !== b.feePerMeterPiastres) return false
  const flat = (areas: InstallationAreas): string =>
    Object.entries(areas)
      .flatMap(([governorate, list]) => Object.entries(list).map(([area, travel]) => governorate + '|' + area + '|' + String(travel)))
      .sort()
      .join('\n')
  return flat(a.areas) === flat(b.areas)
}

const MAX_POUNDS = String(INSTALLATION_LIMITS.maxPiastres / 100)

/** rawExpected: updated_at اللي اللوحة شافته، أو null لو الصف مكانش موجود. */
export async function saveInstallation(raw: unknown, rawExpected: unknown): Promise<MutationResult<InstallationRecord>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'VALIDATION', message: 'البيانات مش صحيحة' }
  }
  const input = raw as Record<string, unknown>
  const enabled = input['enabled']
  if (typeof enabled !== 'boolean') return { ok: false, code: 'VALIDATION', message: 'مفتاح التشغيل مش صحيح' }
  const note = typeof input['note'] === 'string' ? input['note'].trim() : ''
  if (note.length > INSTALLATION_LIMITS.note) {
    return { ok: false, code: 'VALIDATION', message: 'سطر التوضيح أطول من ' + String(INSTALLATION_LIMITS.note) + ' حرف' }
  }

  let fee: number | null = null
  const feeRaw = input['feePerMeterPiastres']
  if (feeRaw !== null && feeRaw !== undefined) {
    if (!isInstallationMoney(feeRaw, 1)) {
      return { ok: false, code: 'VALIDATION', message: 'سعر تركيب المتر لازم يكون من 0.01 لـ ' + MAX_POUNDS + ' جنيه' }
    }
    fee = feeRaw
  }

  const areasRaw = input['areas']
  if (typeof areasRaw !== 'object' || areasRaw === null || Array.isArray(areasRaw)) {
    return { ok: false, code: 'VALIDATION', message: 'المناطق مش صحيحة' }
  }

  try {
    const groups = await readShippingAreaGroups()
    const shipping = new Map(groups.map((group) => [group.governorate, group.areas]))
    const areas: InstallationAreas = {}
    let count = 0
    for (const [governorate, list] of Object.entries(areasRaw as Record<string, unknown>)) {
      const known = shipping.get(governorate)
      if (known === undefined) {
        return { ok: false, code: 'VALIDATION', message: 'محافظة «' + governorate + '» مش موجودة في الشحن — اعمل تحديث للصفحة.' }
      }
      if (typeof list !== 'object' || list === null || Array.isArray(list)) {
        return { ok: false, code: 'VALIDATION', message: 'مناطق ' + governorate + ' مش صحيحة' }
      }
      const out: Record<string, number> = {}
      for (const [area, travel] of Object.entries(list as Record<string, unknown>)) {
        if (!known.includes(area)) {
          return {
            ok: false,
            code: 'VALIDATION',
            message: 'منطقة «' + area + '» مش موجودة في مناطق الشحن لـ' + governorate + ' — اعمل تحديث للصفحة.',
          }
        }
        if (!isInstallationMoney(travel, 0)) {
          return { ok: false, code: 'VALIDATION', message: 'انتقال الفني لـ«' + area + '» لازم يكون من 0 لـ ' + MAX_POUNDS + ' جنيه' }
        }
        out[area] = travel
        count += 1
      }
      if (Object.keys(out).length > 0) areas[governorate] = out
    }
    if (fee === null && (enabled || count > 0)) {
      return { ok: false, code: 'VALIDATION', message: 'اكتب سعر تركيب المتر' }
    }

    const value: Record<string, unknown> = { enabled, note, areas, governorates: installationGovernorates(areas) }
    if (fee !== null) value['feePerMeterPiastres'] = fee

    if (rawExpected === null) {
      try {
        await restInsert('settings', { key: KEY, value })
      } catch (error) {
        // حد تاني عمل الصف في نفس اللحظة → تعارض حقيقي، مش كتابة فوقه
        const now = await readInstallationRecord()
        if (now.updatedAt !== null) return { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
        return toInternalFailure(error)
      }
    } else {
      const stamp = timestamp(rawExpected, 'طابع آخر تعديل')
      if (!stamp.ok) return stamp
      const result = await patchGuarded<{ key: string }>({
        table: 'settings',
        idColumn: 'key',
        idValue: KEY,
        expectedUpdatedAt: stamp.value,
        changes: { value },
        select: 'key',
      })
      if (!result.ok) return result
    }

    const stored = await readInstallationRecord()
    const expected: InstallationConfig = { enabled, note, feePerMeterPiastres: fee, areas }
    if (stored.updatedAt === null || !sameConfig(stored.config, expected)) return toInternalFailure(null)
    return { ok: true, data: stored }
  } catch (error) {
    return toInternalFailure(error)
  }
}
