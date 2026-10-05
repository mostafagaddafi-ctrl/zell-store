'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, ShoppingBag, Wrench } from 'lucide-react'
import {
  formatLength,
  installationReadyGovernorates,
  maxQuantityOf,
  validateLength,
  widthOptionsOf,
  withWidth,
  type InstallationConfig,
  type StoreProduct,
} from '@zell/core'
import { useCart } from '../../lib/cart'
import { buttonClasses, Button } from '../ui/Button'
import { Num } from './Num'
import { GiftNote } from './GiftNote'
import { SizePanel } from './SizePanel'
import { AddonsPicker } from './AddonsPicker'
import { InstallChoice } from './InstallChoice'

/** رابط صفحة «أدوات التركيب» بعد الإضافة — null = الأزرار القديمة زي ما هي. */
export type ToolsLink = { href: string; browseLabel: string; checkoutLabel: string }

/** gift: «نص العرض» لو ظاهر — بيظهر كهدية فوق زرار الإضافة. */
export function ProductBuy({
  product,
  gift = '',
  addons = [],
  addonsTitle = '',
  tools = null,
  installation = null,
}: {
  product: StoreProduct
  gift?: string
  /** 0016 — منتجات قطعة بتتضاف مع الفيلم (بعددها). */
  addons?: StoreProduct[]
  addonsTitle?: string
  /** صفحة الأدوات مفعّلة والفيلم ليه أدوات نشطة مربوطة — مفيش تحويل، اختيار بس. */
  tools?: ToolsLink | null
  /** PR4 — إعداد الفني (0018). null = من غير «هتركّبه إزاي؟». */
  installation?: InstallationConfig | null
}) {
  const cart = useCart()
  const router = useRouter()
  // PR4 — «هتركّبه إزاي؟»: النية على مستوى السلة (cart.installMode)، وCheckout الحكم النهائي
  const installerGovernorates = installation ? installationReadyGovernorates(installation) : []
  const fee = installation?.feePerMeterPiastres ?? null
  const showChoice = installerGovernorates.length > 0 && fee !== null
  const installer = showChoice && cart.installMode === 'installer'
  const [lengthCm, setLengthCm] = useState(product.min_length_cm)
  const [justAdded, setJustAdded] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [addonQty, setAddonQty] = useState<Record<number, number>>({})
  // 0015 — العرض المختار. المنتج بعرض واحد = مفيش اختيار ومفيش تغيير.
  const options = widthOptionsOf(product)
  const [widthCm, setWidthCm] = useState(product.width_cm)
  const effective = withWidth(product, widthCm) ?? product
  const chosenWidth = effective.width_cm === product.width_cm ? undefined : effective.width_cm

  // حارس أخير قبل السلة — حتى لو حالة الواجهة اتلخبطت
  const canAdd = !blocked && validateLength(lengthCm, effective).ok

  const handleAdd = () => {
    if (!canAdd) return
    cart.add(product.id, lengthCm, chosenWidth)
    addSelectedAddons()
    setJustAdded(true)
  }

  /** الإضافات المختارة بتتضاف كسطور قطعة، والاختيار بيتصفّر عشان ماتتكررش. */
  function addSelectedAddons() {
    for (const addon of addons) {
      const quantity = addonQty[addon.id] ?? 0
      if (quantity > 0) cart.addPiece(addon.id, quantity, maxQuantityOf(addon))
    }
    setAddonQty({})
  }

  // «اطلب دلوقتي»: يضيف ويروح للبيانات على طول. لو نفس الاختيار اتضاف
  // لسه (justAdded) مابيضيفوش تاني — يروح بس، عشان مايتكررش في السلة.
  const handleBuyNow = () => {
    if (!canAdd) return
    if (!justAdded) {
      cart.add(product.id, lengthCm, chosenWidth)
      addSelectedAddons()
    }
    router.push('/checkout')
  }

  return (
    <div className="space-y-4">
      {/* العرض جوه كارت المقاس نفسه — وتغييره بيعيد الحساب على نفس مقاس الشباك */}
      <SizePanel
        product={product}
        widthCm={effective.width_cm}
        onWidthChange={(next) => {
          setWidthCm(next)
          setJustAdded(false)
        }}
        lengthCm={lengthCm}
        onLengthChange={(next) => {
          setLengthCm(next)
          setJustAdded(false)
        }}
        onBlockedChange={(next) => {
          setBlocked(next)
          if (next) setJustAdded(false)
        }}
      />

      <GiftNote text={gift} />

      {showChoice && fee !== null ? (
        <InstallChoice
          mode={cart.installMode}
          onChange={(next) => {
            cart.setInstallMode(next)
            // أدوات مختارة ولسه مااتضافتش بتتصفّر — مابتتضافش من غير ما العميل يشوفها
            if (next === 'installer') setAddonQty({})
          }}
          feePerMeterPiastres={fee}
          lengthCm={lengthCm}
          governorates={installerGovernorates}
          context="product"
        />
      ) : null}

      {/* مع الفني اقتراحات الأدوات بتختفي — مش محتاجها */}
      {installer ? null : <AddonsPicker addons={addons} title={addonsTitle} quantities={addonQty} onChange={setAddonQty} />}

      <div className="grid gap-2">
        <Button size="lg" onClick={handleBuyNow} disabled={!canAdd}>
          اطلب دلوقتي
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Button size="lg" variant="secondary" onClick={handleAdd} disabled={!canAdd}>
          <ShoppingBag className="h-5 w-5" />
          ضيف للسلة
        </Button>
      </div>

      {justAdded ? (
        <div className="space-y-3 rounded-lg border border-accent/40 bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Check className="h-4 w-4 text-accent" />
            اتضاف للسلة — <Num>{formatLength(lengthCm)}</Num>
            {options.length > 1 ? (
              <>
                {' · عرض '}
                <Num>{String(effective.width_cm)}</Num>
                {' سم'}
              </>
            ) : null}
          </p>
          {tools && !installer ? (
            <>
              <Link href={tools.href} className={buttonClasses('primary', 'md', 'w-full')}>
                <Wrench className="h-4 w-4" aria-hidden="true" />
                {tools.browseLabel}
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/checkout" className={buttonClasses('secondary', 'md', 'w-full')}>
                  {tools.checkoutLabel}
                </Link>
                <Link href="/cart" className={buttonClasses('secondary', 'md', 'w-full')}>
                  افتح السلة
                </Link>
              </div>
            </>
          ) : (
            <>
              <Link href="/checkout" className={buttonClasses('primary', 'md', 'w-full')}>
                إتمام الطلب
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/cart" className={buttonClasses('secondary', 'md', 'w-full')}>
                  افتح السلة
                </Link>
                <Link href="/" className={buttonClasses('secondary', 'md', 'w-full')}>
                  كمّل تسوّق
                </Link>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
