'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ShoppingBag } from 'lucide-react'
import { formatLength, validateLength, type StoreProduct } from '@zell/core'
import { useCart } from '../../lib/cart'
import { buttonClasses, Button } from '../ui/Button'
import { Num } from './Num'
import { SizePanel } from './SizePanel'

export function ProductBuy({ product }: { product: StoreProduct }) {
  const cart = useCart()
  const [lengthCm, setLengthCm] = useState(product.min_length_cm)
  const [justAdded, setJustAdded] = useState(false)
  const [blocked, setBlocked] = useState(false)

  // حارس أخير قبل السلة — حتى لو حالة الواجهة اتلخبطت
  const canAdd = !blocked && validateLength(lengthCm, product).ok

  const handleAdd = () => {
    if (!canAdd) return
    cart.add(product.id, lengthCm)
    setJustAdded(true)
  }

  return (
    <div className="space-y-4">
      <SizePanel
        product={product}
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
