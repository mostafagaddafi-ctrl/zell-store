/**
 * طبقة الوصول للبيانات — المكان الصغير الوحيد المرتبط بـ Retool.
 * عند النقل لـ Next.js/Vercel: استبدل جسم \`sql\` بعميل Postgres (مثلاً \`postgres\`/\`pg\`
 * أو Supabase client) — باقي الكود مايتغيّرش لأنه بيستخدم \`sql()\` بس.
 *
 * ملاحظة: الدوال اللي بتمرّر parameters بتنادي supabase.query مباشرة، لأن محلّل
 * الأمان في Retool بيرفض تمرير نص استعلام من متغيّر مع parameters.
 */

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await supabase.query<T>(text, params)
  return result.data
}

export type SettingsMap = Record<string, unknown>

/** كل الإعدادات كـ map جاهز للاستخدام. */
export async function loadSettings(): Promise<SettingsMap> {
  const rows = await sql<{ key: string; value: unknown }>('select key, value from settings')
  const out: SettingsMap = {}
  for (const row of rows) out[row.key] = row.value
  return out
}

export function settingString(settings: SettingsMap, key: string, fallback = ''): string {
  const value = settings[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return fallback
}

export function settingNumber(settings: SettingsMap, key: string, fallback = 0): number {
  const value = settings[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return fallback
}

export function settingRecord(settings: SettingsMap, key: string): Record<string, number> {
  const value = settings[key]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'number') out[k] = v
      else if (typeof v === 'string' && !Number.isNaN(Number(v))) out[k] = Number(v)
    }
    return out
  }
  return {}
}
