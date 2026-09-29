import type { Metadata, Viewport } from 'next'
import { Cairo } from 'next/font/google'
import type { ReactNode } from 'react'
import { CartProvider } from '../lib/cart'
import { getSettings } from '../lib/catalog'
import './globals.css'

// Cairo خط متغيّر (variable font) — من غير weight عشان ياخد كل الأوزان
const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  display: 'swap',
  variable: '--font-cairo',
})

const settings = getSettings()

export const metadata: Metadata = {
  title: {
    default: settings.storeName + ' — أفلام حماية الزجاج بالمتر',
    template: '%s · ' + settings.storeName,
  },
  description:
    'أفلام حماية وعزل للزجاج للبيوت والشقق، تتباع بالمتر الطولي. عازل حرارة، مصنفر للخصوصية، وفاميه أسود. الدفع عند الاستلام وتوصيل لكل محافظات مصر.',
  applicationName: settings.storeName,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#16365A',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  )
}
