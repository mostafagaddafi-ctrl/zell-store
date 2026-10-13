import type { Announcement, HomeMobileLayout } from '@zell/core'

/**
 * HOME-MOBILE — قرارات العرض في الرئيسية (docs/contracts/HOME-MOBILE.md §٣ و§٥). منطق خالص.
 *
 * في 'compact' تحت sm بس: شريط الأقسام للموبايل برّه لوب الأجزاء تحت الهيدر على طول (sm:hidden)، والنسخة اللي
 * في اللوب hidden sm:block — فنسخة واحدة بس ظاهرة في أي مقاس، والتانية display:none (برّه قارئ الشاشة كمان)،
 * ومهما الترتيب في اللوحة اتغيّر. في 'full' كل حاجة زي قبل العقد بالحرف.
 */

/** media الكمبيوتر والتابلت (sm = 640px) — صورة الواجهة في compact بتتطلب بيه بس. */
export const DESKTOP_MEDIA = '(min-width: 640px)'

/** placeholder الـ img تحت 640px في compact: GIF شفاف 1×1 جوه الكود (مفيش أي طلب للشبكة، ومش src فاضي). */
export const MOBILE_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** نفس sizes بتاع صورة الواجهة قبل العقد. */
export const HERO_IMAGE_SIZES = '(min-width: 768px) 50vw, 100vw'

export type HomeMobileView = {
  /** شريط الأقسام للموبايل فوق خالص (برّه اللوب). */
  mobileTopNav: boolean
  mobileTopNavClassName: string
  /** كلاسات نسخة شريط الأقسام اللي جوه اللوب (بعد الواجهة، بعنوانها). */
  loopNavClassName: string
  /** الواجهة بشكل الموبايل المختصر (h1 للقارئ بس · الوصف والزرار والصورة مستخبيين). */
  heroCompact: boolean
  /** كلاسات جزء المنتجات. */
  productsClassName: string
}

export function homeMobileView(layout: HomeMobileLayout): HomeMobileView {
  if (layout === 'full') {
    return { mobileTopNav: false, mobileTopNavClassName: '', loopNavClassName: '', heroCompact: false, productsClassName: 'py-10 md:py-14' }
  }
  return {
    mobileTopNav: true,
    mobileTopNavClassName: 'border-b border-border pb-3 pt-4 sm:hidden',
    loopNavClassName: 'hidden sm:block',
    heroCompact: true,
    // pt-6 pb-10 تحت sm بس؛ من sm لفوق زي قبل العقد بالحرف (§٣-٣)
    productsClassName: 'py-10 max-sm:pt-6 md:py-14',
  }
}

/**
 * شريط الثقة (§٥): سطر الثقة بعد trim، في كل الصفحات تحت sm في الوضعين (قرار المالك).
 * فاضي = مخفي. ولو شريط الإعلان ظاهر (نفس شرط AnnouncementBar) = مخفي.
 */
export function trustBarText(announcement: Pick<Announcement, 'enabled' | 'text'>, trustLine: string): string | null {
  if (announcement.enabled && announcement.text.trim() !== '') return null
  const text = trustLine.trim()
  return text === '' ? null : text
}
