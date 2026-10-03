'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ShoppingBag } from 'lucide-react'
import { formatLength, validateLength, widthOptionsOf, withWidth, type StoreProduct } from '@zell/core'
import { useCart } from '../../lib/cart'
import { buttonClasses, Button } from '../ui/Button'
import { Num } from './Num'
import { GiftNote } from './GiftNote'
import { SizePanel } from './SizePanel'
import { WidthPicker } from './WidthPicker'

/** gift: «نص العرض» لو ظاهر — بيظهر كهدية فوق زرار الإضافة. */
export function ProductBuy({ product, gift = '' }: { product: StoreProduct; gift?: string }) {
  const cart = useCart()
  const [lengthCm, setLengthCm] = useState(product.min_length_cm)
  const [justAdded, setJustAdded] = useState(false)
  const [blocked, setBlocked] = useState(false)
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
    setJustAdded(true)
  }

  return (
    <div className="space-y-4">
      <WidthPicker
        options={options}
        value={effective.width_cm}
        onChange={(next) => {
          setWidthCm(next)
          setBlocked(false)
          setJustAdded(false)
        }}
      />

      {/* key: تغيير العرض بيعيد حساب الشرايح من الأول */}
      <SizePanel
        key={String(effective.width_cm)}
        product={effective}
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

      <Button size="lg" onClick={handleAdd} disabled={!canAdd}>
        <ShoppingBag className="h-5 w-5" />
        ضيف للسلة
      </Button>

      {justAdded ? (
        <div className="space-y-3 rounded-lg border border-accent/40 bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Check className="h-4 w-4 text-accent" />
            اتضاف للسلة — <Num>{formatLength(lengthCm)}</Num>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/cart" className={buttonClasses('primary', 'md', 'w-full')}>
              افتح السلة
            </Link>
            <Link href="/" className={buttonClasses('secondary', 'md', 'w-full')}>
              كمّل تسوّق
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
