import type { Metadata, Viewport } from 'next'
import { Cairo } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

/**
 * الـ layout الجذري بقى **هيكل HTML وبس**.
 *
 * قبل المرحلة ج كان بيقرا من الداتابيز ويرسم AdminShell، وده كان
 * بيخلي /login و/403 يحتاجوا مفاتيح وجلسة عشان يتعرضوا أصلًا.
 * دلوقتي:
 *   (auth)      -> صفحات عامة، من غير أي قراءة
 *   (dashboard) -> requireAdminPage + الشِل + قراءة الملخّص
 */
export const dynamic = 'force-dynamic'

const cairo = Cairo({ subsets: ['arabic', 'latin'], display: 'swap', variable: '--font-cairo' })

export const metadata: Metadata = {
  title: { default: 'لوحة تحكم ZELL', template: '%s · لوحة تحكم ZELL' },
  description: 'إدارة متجر ZELL',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#FAF7F2' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="bg-bg font-sans text-fg antialiased">{children}</body>
    </html>
  )
}
