import type { ChosenInstallMode, InstallMode } from '../cart'

/**
 * «هتركّبه إزاي؟» في صفحة المنتج — منطق خالص (بيتشغّل في حالات المتجر: pnpm --filter @zell/storefront cases).
 *
 * الاختيار **واحد للطلب كله** (cart.installMode، مفتاح zell-install-mode-v1)، والصفحة دي بتعرضه وبتغيّره بس.
 * مفيش أي تغيير في السعر ولا في Checkout (Checkout هو الحكم النهائي حسب المحافظة والمنطقة).
 */

export const INSTALL_MODE_LABELS: Readonly<Record<ChosenInstallMode, string>> = {
  self: 'هركّبه بنفسي',
  installer: 'محتاج فني تركيب',
}

/** سطر الاختيار الحالي جنب «هتركّبه إزاي؟»: بيظهر بس لو الاختيار متحدد (مش unset). */
export function currentInstallModeLine(mode: InstallMode): string | null {
  if (mode === 'unset') return null
  return 'اختيارك الحالي: «' + INSTALL_MODE_LABELS[mode] + '» — للطلب كله، وتقدر تغيّره من هنا.'
}

/**
 * «هركّبه بنفسي» بعد اختيار تاني (فني أو لسه مااختارش) وفيه أدوات = الأدوات بتظهر والتركيز يروح لها.
 * نفس شرط صفحة المنتج قبل الملف ده بالحرف.
 */
export function revealToolsOnChange(previous: InstallMode, next: ChosenInstallMode, addonCount: number): boolean {
  return next === 'self' && previous !== 'self' && addonCount > 0
}

/**
 * اقتراحات الأدوات بتظهر إمتى (نفس شرط صفحة المنتج قبل الملف ده بالحرف): مش مع الفني، ومش قبل قراية الاختيار المحفوظ،
 * ومش قبل ما العميل يختار، ولازم يكون فيه أدوات.
 */
export function showToolSuggestions(state: { installer: boolean; choicePending: boolean; choiceRequired: boolean; addonCount: number }): boolean {
  return !(state.installer || state.choicePending || state.choiceRequired || state.addonCount === 0)
}
