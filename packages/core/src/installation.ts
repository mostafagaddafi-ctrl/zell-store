/**
 * settings.installation — فني التركيب (0018).
 *
 *   { enabled, note, feePerMeterPiastres, areas: { محافظة: { منطقة: انتقال بالقرش } }, governorates }
 *
 * ⚠️ الحَكَم هو zell_create_order: سعر المتر عدد صحيح 1..1,000,000 قرش، والانتقال 0..1,000,000.
 *    أي قيمة بره الحدود دي الداتابيز بترفضها، فالقراءة هنا بتسقطها بنفس الحدود.
 * ⚠️ governorates مشتق من areas (المحافظات اللي فيها منطقة مفعّلة) عشان نسخة المتجر اللي
 *    لسه بتقراه تفضل شغالة. مابيتكتبش بإيد.
 */

export const INSTALLATION_LIMITS = { note: 300, area: 40, maxPiastres: 1_000_000 } as const

/** { محافظة: { منطقة: انتقال الفني بالقرش } } — المنطقة الموجودة هنا = متاحة للفني. */
export type InstallationAreas = Record<string, Record<string, number>>

export type InstallationConfig = {
  enabled: boolean
  note: string
  /** null = لسه متحددش، والفني مش متاح لحد ما يتكتب. */
  feePerMeterPiastres: number | null
  areas: InstallationAreas
}

/** رقم صحيح بالقرش من min لحد الأقصى — نفس حدود zell_create_order. */
export function isInstallationMoney(value: unknown, min: 0 | 1): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= INSTALLATION_LIMITS.maxPiastres
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function parseInstallationConfig(value: unknown): InstallationConfig {
  const raw = asRecord(value) ?? {}
  const areas: InstallationAreas = {}
  const rawAreas = asRecord(raw['areas'])
  if (rawAreas) {
    for (const [governorate, list] of Object.entries(rawAreas)) {
      const entries = asRecord(list)
      if (!entries) continue
      const out: Record<string, number> = {}
      for (const [area, travel] of Object.entries(entries)) {
        const name = area.trim()
        if (name === '' || !isInstallationMoney(travel, 0)) continue
        out[name] = travel
      }
      if (Object.keys(out).length > 0) areas[governorate] = out
    }
  }
  const fee = raw['feePerMeterPiastres']
  return {
    enabled: raw['enabled'] === true,
    note: typeof raw['note'] === 'string' ? raw['note'] : '',
    feePerMeterPiastres: isInstallationMoney(fee, 1) ? fee : null,
    areas,
  }
}

/** المحافظات اللي فيها منطقة مفعّلة واحدة على الأقل، بترتيب areas. */
export function installationGovernorates(areas: InstallationAreas): string[] {
  return Object.keys(areas).filter((governorate) => Object.keys(areas[governorate] ?? {}).length > 0)
}
