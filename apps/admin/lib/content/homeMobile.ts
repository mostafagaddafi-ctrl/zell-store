/**
 * HOME-MOBILE — «تخطيط أعلى الصفحة الرئيسية على الهاتف» في اللوحة (docs/contracts/HOME-MOBILE.md §٢). منطق خالص.
 *
 * الحقل mobileLayout على عنصر hero في settings.sections بس. القراية: غايب أو غلط = 'compact'.
 * اللوحة لازم تقراه وتكتبه (readSections · validateSections بيبنوا القسم من الحقول المعروفة بس)، وإلا بيضيع مع أول حفظ.
 */
export type HomeMobileLayout = 'compact' | 'full'

export const DEFAULT_HOME_MOBILE_LAYOUT: HomeMobileLayout = 'compact'

/** نصوص الإعداد رسمية (فصحى مبسّطة، من غير كلام موجّه لصاحب المحل) — اللوحة ممكن تتباع لمحلات تانية. */
export const HOME_MOBILE_TITLE = 'تخطيط أعلى الصفحة الرئيسية على الهاتف'

export const HOME_MOBILE_OPTIONS: ReadonlyArray<{ value: HomeMobileLayout; label: string; hint: string }> = [
  { value: 'compact', label: 'مختصر: عرض الأقسام أولًا', hint: 'يعرض دوائر الأقسام أعلى الصفحة مباشرةً، ويُخفي العنوان والوصف والزر والصورة على شاشات الهاتف.' },
  { value: 'full', label: 'كامل: عرض الواجهة كاملة', hint: 'يعرض العنوان والوصف والزر والصورة على شاشات الهاتف.' },
]

export const HOME_MOBILE_MESSAGES = {
  invalid: 'يُرجى اختيار تخطيط أعلى الصفحة على الهاتف: مختصر أو كامل.',
  heroOnly: 'هذا الإعداد متاح لقسم الواجهة فقط.',
} as const

/** يتعرض تحت الاختيارين. */
export const HOME_MOBILE_NOTE = 'لا يؤثر هذا الإعداد على شاشات الحاسوب والأجهزة اللوحية، ولا على خيار «إظهار الواجهة».'

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
