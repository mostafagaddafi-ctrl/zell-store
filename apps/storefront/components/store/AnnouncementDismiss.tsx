'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * ANNOUNCE-CLOSE — غلاف الشريط العلوي بزرار إغلاق (طلب المالك 2026-11-15).
 *
 * • الإغلاق بيخفي الشريط **للجلسة بس** («لحد ما يدخل تاني»): sessionStorage، فبيفضل مختفي في نفس التاب
 *   (التنقّل والريفرش)، ويرجع في زيارة جديدة (تاب أو نافذة جديدة). مفيش حفظ دائم، والمفتاح مش مربوط بنص الإعلان.
 * • الإعلان نفسه ومحتواه من اللوحة ماتغيّروش — المحتوى بيتبني في AnnouncementBar (Server Component) وبيجي هنا children.
 * • أول رسم = الشريط ظاهر عند الكل (نفس HTML السيرفر، من غير hydration mismatch)، وبعد التركيب لو اتقفل في الجلسة بيختفي.
 * • النص بيفضل متوسّط: حشو متساوي من الناحيتين بعرض الزرار، والزرار في الناحية التانية من غير ما يزحم النص.
 */
const DISMISS_KEY = 'zell-announcement-dismissed-v1'

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function AnnouncementDismiss({ children }: { children: ReactNode }) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (readDismissed()) setDismissed(true)
  }, [])

  if (dismissed) return null

  const close = () => {
    setDismissed(true)
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // التخزين مقفول — الشريط بيختفي في الصفحة دي بس
    }
  }

  return (
    <aside aria-label="إعلان" className="relative bg-brand text-brand-fg">
      <div className="px-9">{children}</div>
      <button
        type="button"
        onClick={close}
        aria-label="إغلاق الإعلان"
        className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-brand-fg/80 transition-colors hover:text-brand-fg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-fg"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </aside>
  )
}
