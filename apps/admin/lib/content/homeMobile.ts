/**
 * HOME-MOBILE — «أول الصفحة على الموبايل» في اللوحة (docs/contracts/HOME-MOBILE.md §٢). منطق خالص.
 *
 * الحقل mobileLayout على عنصر hero في settings.sections بس. القراية: غايب أو غلط = 'compact'.
 * اللوحة لازم تقراه وتكتبه (readSections · validateSections بيبنوا القسم من الحقول المعروفة بس)، وإلا بيضيع مع أول حفظ.
 */
export type HomeMobileLayout = 'compact' | 'full'

export const DEFAULT_HOME_MOBILE_LAYOUT: HomeMobileLayout = 'compact'

export const HOME_MOBILE_OPTIONS: ReadonlyArray<{ value: HomeMobileLayout; label: string; hint: string }> = [
  { value: 'compact', label: 'مختصر — الأقسام الأول', hint: 'على الموبايل: دواير الأقسام فوق على طول، والعنوان والوصف والزرار والصورة مستخبيين.' },
  { value: 'full', label: 'كامل — العنوان والوصف والزرار', hint: 'على الموبايل: الواجهة كاملة زي قبل كده.' },
]

export const HOME_MOBILE_MESSAGES = {
  invalid: 'اختار شكل أول الصفحة على الموبايل: مختصر أو كامل.',
  heroOnly: 'إعداد «أول الصفحة على الموبايل» للواجهة بس.',
} as const

/** القراية (اللوحة): نفس قاعدة المتجر بالحرف — 'full' بس هي full، وأي حاجة تانية compact. */
export function readHeroMobileLayout(raw: unknown): HomeMobileLayout {
  return raw === 'full' ? 'full' : 'compact'
}

export type MobileLayoutCheck = { ok: true; value: HomeMobileLayout | null } | { ok: false; message: string }

/**
 * التحقق في السيرفر (validateSections): لـ hero القيمة compact أو full (غايبة = compact)، وأي قيمة تانية = رفض.
 * على أي جزء تاني الحقل مرفوض (value = null يعني مايتكتبش).
 */
export function checkSectionMobileLayout(key: string, raw: unknown): MobileLayoutCheck {
  if (key !== 'hero') return raw === undefined || raw === null ? { ok: true, value: null } : { ok: false, message: HOME_MOBILE_MESSAGES.heroOnly }
  if (raw === undefined || raw === null) return { ok: true, value: DEFAULT_HOME_MOBILE_LAYOUT }
  if (raw === 'compact' || raw === 'full') return { ok: true, value: raw }
  return { ok: false, message: HOME_MOBILE_MESSAGES.invalid }
}
