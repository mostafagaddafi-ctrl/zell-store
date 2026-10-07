/**
 * حماية التنقل الداخلي — قرار «نعترض الضغطة دي ولا لأ؟» كدالة خالصة قابلة للاختبار.
 * المكوّن اللي بيستخدمها: components/inventory/UnsavedChangesGuard.tsx (listener واحد للصفحة).
 *
 * بنعترض بس الضغطة اللي هتعمل تنقل جوه نفس التاب لصفحة تانية في نفس الموقع:
 *   • زرار الماوس الأساسي، من غير Ctrl/Meta/Shift/Alt (دول بيفتحوا تاب/شباك جديد).
 *   • من غير target غير _self، ومن غير download.
 *   • نفس الـorigin (الروابط الخارجية في نفس التاب بيغطيها beforeunload).
 *   • مش نفس الصفحة ومش مجرد #hash في نفس الصفحة.
 *   • ضغطة اتمنعت قبل كده (defaultPrevented) مابنلمسهاش.
 */

export type ClickInfo = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  /** خاصية target بتاعة الرابط (أو null). */
  target: string | null
  download: boolean
  /** href زي ما هو مكتوب على الرابط (نسبي أو كامل) أو null. */
  href: string | null
  /** location.href الحالي. */
  currentHref: string
}

export function shouldGuardClick(info: ClickInfo): boolean {
  if (info.defaultPrevented) return false
  if (info.button !== 0) return false
  if (info.metaKey || info.ctrlKey || info.shiftKey || info.altKey) return false
  if (info.download) return false
  if (info.target !== null && info.target !== '' && info.target !== '_self') return false
  if (info.href === null || info.href.trim() === '') return false

  let next: URL
  let current: URL
  try {
    current = new URL(info.currentHref)
    next = new URL(info.href, current)
  } catch {
    return false
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') return false
  if (next.origin !== current.origin) return false
  if (next.pathname === current.pathname && next.search === current.search) return false
  return true
}

export const UNSAVED_CHANGES_MESSAGE = 'في تعديلات مش محفوظة. لو خرجت دلوقتي هتضيع. تخرج من غير حفظ؟'
