import type { ReactNode } from 'react'

/**
 * المجموعة العامة: /login و/403.
 *
 * ممنوع أي قراءة من الداتابيز هنا وممنوع أي حارس — دي الصفحات
 * اللي المفروض توصل من غير جلسة ومن غير مفاتيح خدمة.
 */
export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
