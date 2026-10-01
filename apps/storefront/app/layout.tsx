import type { Metadata, Viewport } from 'next'
import { Cairo } from 'next/font/google'
import type { ReactNode } from 'react'
import { AnnouncementBar } from '../components/store/AnnouncementBar'
import { SiteFooter } from '../components/store/SiteFooter'
import { SiteHeader } from '../components/store/SiteHeader'
import { CartProvider } from '../lib/cart'
import { getStorefrontData } from '../lib/data/source'
import './globals.css'

// Cairo خط متغيّر — من غير weight عشان ياخد كل الأوزان
const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  display: 'swap',
  variable: '--font-cairo',
})

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getStorefrontData()
  return {
    title: {
      default: settings.storeName + ' — أفلام حماية الزجاج بالمتر',
      template: '%s · ' + settings.storeName,
    },
    description:
      'أفلام حماية وعزل للزجاج للبيوت والشقق، تتباع بالمتر الطولي. عازل حرارة، مصنفر للخصوصية، وفاميه أسود. الدفع عند الاستلام وتوصيل لكل محافظات مصر.',
    applicationName: settings.storeName,
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FAF7F2',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { settings } = await getStorefrontData()

  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="flex min-h-dvh flex-col bg-bg font-sans text-fg antialiased">
        <CartProvider>
          {/* فوق الهيدر — settings متاحة هنا أصلاً، فمفيش fetch زيادة */}
          <AnnouncementBar announcement={settings.announcement} />
          <SiteHeader
            storeName={settings.storeName}
            logo={settings.logo}
            whatsappNumber={settings.whatsappNumber}
            whatsappMessage={settings.whatsappMessage}
          />
          <div className="flex-1">{children}</div>
          <SiteFooter
            storeName={settings.storeName}
            whatsappNumber={settings.whatsappNumber}
            whatsappMessage={settings.whatsappMessage}
          />
        </CartProvider>
      </body>
    </html>
  )
}
