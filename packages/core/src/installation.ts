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

/**
 * INSTALLER-ONLY (قرار المالك 2026-11-05) — طريقة التركيب من صفحة «فني التركيب» في اللوحة:
 *   choice              العميل يختار (زي ما هو — الافتراضي، والإعداد القديم من غير mode)
 *   installer_all       فني فقط لكل أفلام المقاس
 *   installer_products  فني فقط للمنتجات في installerOnlyProductIds
 */
export const INSTALLATION_MODES = ['choice', 'installer_all', 'installer_products'] as const
export type InstallationMode = (typeof INSTALLATION_MODES)[number]
export const INSTALLER_ONLY_MAX_PRODUCTS = 500

export function isInstallationMode(value: unknown): value is InstallationMode {
  return typeof value === 'string' && (INSTALLATION_MODES as readonly string[]).includes(value)
}

/** معرّفات منتجات: أرقام صحيحة موجبة من غير تكرار، بالترتيب، لحد الأقصى. أي قيمة غلط بتتشال. */
export function parseInstallerOnlyIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0 || out.includes(item)) continue
    out.push(item)
    if (out.length >= INSTALLER_ONLY_MAX_PRODUCTS) break
  }
  return out
}

/** { محافظة: { منطقة: انتقال الفني بالقرش } } — المنطقة الموجودة هنا = متاحة للفني. */
export type InstallationAreas = Record<string, Record<string, number>>

export type InstallationConfig = {
  enabled: boolean
  note: string
  /** null = لسه متحددش، والفني مش متاح لحد ما يتكتب. */
  feePerMeterPiastres: number | null
  areas: InstallationAreas
  /** INSTALLER-ONLY — ناقص = 'choice' (العميل يختار). */
  mode?: InstallationMode
  /** INSTALLER-ONLY — أفلام «فني فقط» لما mode = 'installer_products'. */
  installerOnlyProductIds?: number[]
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
  const mode = raw['mode']
  return {
    enabled: raw['enabled'] === true,
    note: typeof raw['note'] === 'string' ? raw['note'] : '',
    feePerMeterPiastres: isInstallationMoney(fee, 1) ? fee : null,
    areas,
    mode: isInstallationMode(mode) ? mode : 'choice',
    installerOnlyProductIds: parseInstallerOnlyIds(raw['installerOnlyProductIds']),
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

/** المحافظات اللي فيها منطقة متاحة للفني — فاضية لو الفني مقفول أو سعر المتر ناقص. */
export function installationReadyGovernorates(config: InstallationConfig): string[] {
  if (!config.enabled || config.feePerMeterPiastres === null) return []
  return installationGovernorates(config.areas)
}

/**
 * INSTALLER-ONLY (قرار المالك 2026-11-05) — المنتج ده «فني فقط»؟ عرض بس: zell_create_order مالهاش دعوة بيه.
 * بس لما الفني متاح فعلًا (installationReadyGovernorates مش فاضية) — لو الخدمة مقفولة أو مالهاش سعر أو مناطق،
 * كل حاجة شغالة زي ما هي والعميل بيختار عادي.
 */
export function installerRequiredFor(config: InstallationConfig, productId: number): boolean {
  if (installationReadyGovernorates(config).length === 0) return false
  if (config.mode === 'installer_all') return true
  if (config.mode === 'installer_products') return (config.installerOnlyProductIds ?? []).includes(productId)
  return false
}

/**
 * INSTALLER-ONLY — الطلب كله «فني فقط» لو فيه منتج بالمقاس واحد «فني فقط» (الاختيار واحد للطلب كله).
 * منتجات القطعة (الأدوات) مش داخلة.
 */
export function orderRequiresInstaller(
  config: InstallationConfig,
  products: ReadonlyArray<{ id: number; sale_unit?: string }>,
): boolean {
  return products.some((product) => product.sale_unit !== 'piece' && installerRequiredFor(config, product.id))
}
