import type { Metadata } from 'next'
import { CartView } from '../../components/store/CartView'
import { BackButton } from '../../components/ui/BackButton'
import { Container } from '../../components/ui/Container'
import { getStorefrontData } from '../../lib/data/source'

export const metadata: Metadata = { title: 'السلة' }

export default async function CartPage() {
  const { products, settings } = await getStorefrontData()

  return (
    <Container className="py-8 md:py-12">
      {/* رجوع بسجل المتصفح، وإلا للتسوق */}
      <BackButton fallback="/" />
      <h1 className="mt-2 text-xl font-extrabold text-fg md:text-2xl">سلة الطلب</h1>
      <div className="mt-6">
        <CartView
          products={products}
          trustLine={settings.content.trustLine}
          gift={settings.offerEnabled ? settings.offerText : ''}
          tools={settings.installationToolsPage.enabled ? { browseLabel: settings.installationToolsPage.browseButtonLabel } : null}
          installation={settings.installation}
        />
      </div>
    </Container>
  )
}
