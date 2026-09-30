import type { Metadata, Viewport } from 'next'
import { Cairo } from 'next/font/google'
import type { ReactNode } from 'react'
import { AdminShell } from '../components/shell/AdminShell'
import { adminData } from '../lib/adminData'
import { mutationsEnabled } from '../lib/mutations'
import { ReadinessProvider } from '../lib/readiness'
import './globals.css'

/**
 * اللوحة كلها ديناميكية.
 *
 * السبب الأول: بتعرض حالة تشغيل لحظية — الطلبات والمخزون والجاهزية —
 * وأي prerender بيعرض بيانات قديمة.
 * السبب التاني: من غير كده البناء بيحاول يقرا من الداتابيز وقت البناء،
 * فالـ CI (اللي مالوش مفاتيح وما المفروض يكون ليه) كان هيفشل.
 */
export const dynamic = 'force-dynamic'

const cairo = Cairo({ subsets: ['arabic', 'latin'], display: 'swap', variable: '--font-cairo' })

export const metadata: Metadata = {
  title: { default: 'لوحة تحكم ZELL', template: '%s · لوحة تحكم ZELL' },
  description: 'إدارة متجر ZELL',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#FAF7F2' }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const summary = await adminData.getOrdersSummary()
  const enabled = mutationsEnabled()

  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="bg-bg font-sans text-fg antialiased">
        <ReadinessProvider enabled={enabled}>
          <AdminShell newOrders={summary.newCount}>{children}</AdminShell>
        </ReadinessProvider>
      </body>
    </html>
  )
}
