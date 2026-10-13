import type { HomeMobileLayout } from './types'

/**
 * HOME-MOBILE — «أول الصفحة على الموبايل» (docs/contracts/HOME-MOBILE.md §٢).
 *
 * الحقل mobileLayout على عنصر hero في settings.sections بس. غايب أو قيمته غلط = 'compact'
 * (قرار المالك 2026-10-12: الجديد هو الافتراضي). منطق خالص من غير I/O.
 */
export const HOME_MOBILE_LAYOUTS: readonly HomeMobileLayout[] = ['compact', 'full']
export const DEFAULT_HOME_MOBILE_LAYOUT: HomeMobileLayout = 'compact'

export function parseHomeMobileLayout(raw: unknown): HomeMobileLayout {
  return raw === 'full' ? 'full' : 'compact'
}

/** من settings.sections الخام: أول عنصر hero، وإلا الافتراضي. الحقل على أي جزء تاني مالوش أثر. */
export function heroMobileLayoutOf(sections: unknown): HomeMobileLayout {
  if (!Array.isArray(sections)) return DEFAULT_HOME_MOBILE_LAYOUT
  for (const item of sections) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (row['key'] === 'hero') return parseHomeMobileLayout(row['mobileLayout'])
  }
  return DEFAULT_HOME_MOBILE_LAYOUT
}
