import type { Metadata, Viewport } from 'next'
import { Cairo } from 'next/font/google'
import type { ReactNode } from 'react'
import { hasInstallationTools } from '@zell/core'
import { AnnouncementBar } from '../components/store/AnnouncementBar'
import { SiteFooter } from '../components/store/SiteFooter'
import { SiteHeader } from '../components/store/SiteHeader'
import { WhatsAppFab } from '../components/store/WhatsAppFab'
import { NavHistory } from '../components/ui/BackButton'
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
  const { settings, collections, products } = await getStorefrontData()
  // لينك «أدوات التركيب» في قائمة الموبايل: الصفحة مفعّلة وفيه أداة نشطة مربوطة بفيلم نشط
  const toolsPage = settings.installationToolsPage
  const toolsLink = toolsPage.enabled && hasInstallationTools(products) ? { href: '/installation-tools', label: toolsPage.title } : null

  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="flex min-h-dvh flex-col bg-bg font-sans text-fg antialiased">
        <CartProvider>
          {/* مسارات التاب ده لزرار «رجوع» — مابيعرضش حاجة */}
          <NavHistory />
          {/* فوق الهيدر — settings متاحة هنا أصلاً، فمفيش fetch زيادة */}
          <AnnouncementBar announcement={settings.announcement} />
          <SiteHeader
            storeName={settings.storeName}
            logo={settings.logo}
            collections={collections}
            allLabel={settings.homeProducts.allLabel}
            social={settings.socialLinks}
            whatsappNumber={settings.whatsappNumber}
            whatsappMessage={settings.whatsappMessage}
            toolsLink={toolsLink}
          />
          {/*
            ⚠️ الحشو السفلي على الموبايل مش تزيين: الزرار العائم fixed،
               فمن غير الحشو ده بيقعد فوق آخر عنصر في الصفحة. على
               الديسكتوب الزرار مخفي فالحشو بيتشال.
          */}
          <div className="flex-1 pb-20 md:pb-0">{children}</div>
          <WhatsAppFab number={settings.whatsappNumber} message={settings.whatsappMessage} />
          <SiteFooter
            storeName={settings.storeName}
            links={settings.content.footerLinks}
            social={settings.socialLinks}
            whatsappNumber={settings.whatsappNumber}
            whatsappMessage={settings.whatsappMessage}
          />
        </CartProvider>
      </body>
    </html>
  )
}
