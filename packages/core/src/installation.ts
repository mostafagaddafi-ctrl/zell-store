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

/**
 * طول التركيب = مجموع أطوال سطور المقاس بالسنتيمتر. المنتجات بالعدد مش داخلة —
 * نفس zell_create_order (sum(length_cm) filter (where sale_unit = 'meter')).
 */
export function installationLengthCm(
  entries: ReadonlyArray<{ product: { sale_unit?: string }; line: { lengthCm: number } }>,
): number {
  let total = 0
  for (const entry of entries) {
    if (entry.product.sale_unit === 'piece') continue
    if (Number.isInteger(entry.line.lengthCm) && entry.line.lengthCm > 0) total += entry.line.lengthCm
  }
  return total
}

/**
 * أجر التركيب بالقرش = round(سعر المتر × الطول ÷ ١٠٠) بأرقام صحيحة من غير float.
 * القيم موجبة، فالنص بيتقرب لفوق — نفس round(numeric) في zell_create_order بالحرف.
 * للعرض بس؛ الرقم المعتمد من الداتابيز.
 */
export function installationFeePiastres(feePerMeterPiastres: number, lengthCm: number): number {
  if (!Number.isInteger(feePerMeterPiastres) || !Number.isInteger(lengthCm)) return 0
  if (feePerMeterPiastres <= 0 || lengthCm <= 0) return 0
  const product = feePerMeterPiastres * lengthCm
  const rest = product % 100
  return (product - rest) / 100 + (rest >= 50 ? 1 : 0)
}

/** المناطق المتاحة للفني في محافظة — فاضية لو الفني مقفول أو سعر المتر ناقص. */
export function installationAreasIn(config: InstallationConfig, governorate: string): string[] {
  if (!config.enabled || config.feePerMeterPiastres === null) return []
  return Object.keys(config.areas[governorate] ?? {})
}

/** انتقال الفني لمنطقة بالقرش — null = الفني مش متاح هناك. */
export function installationTravelPiastres(config: InstallationConfig, governorate: string, area: string): number | null {
  if (!config.enabled || config.feePerMeterPiastres === null) return null
  const travel = config.areas[governorate]?.[area]
  return travel === undefined ? null : travel
}
