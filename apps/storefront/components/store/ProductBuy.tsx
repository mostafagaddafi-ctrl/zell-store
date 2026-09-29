'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ShoppingBag } from 'lucide-react'
import { computeSubtotalPiastres, formatLength, formatPiastres, validateLength, type StoreProduct } from '@zell/core'
import { useCart } from '../../lib/cart'
import { buttonClasses } from '../ui/Button'
import { Num } from './Num'
import { SizePicker } from './SizePicker'

export function ProductBuy({ product }: { product: StoreProduct }) {
  const cart = useCart()
  const [lengthCm, setLengthCm] = useState(product.min_length_cm)
  const [justAdded, setJustAdded] = useState(false)
  const [blocked, setBlocked] = useState(false)

  const total = computeSubtotalPiastres(product.price_per_meter_piastres, lengthCm)
  // حارس أخير قبل السلة — حتى لو حالة الواجهة اتلخبطت
  const lengthCheck = validateLength(lengthCm, product)
  const canAdd = !blocked && lengthCheck.ok

  const handleAdd = () => {
    if (!canAdd) return
    cart.add(product.id, lengthCm)
    setJustAdded(true)
  }

  return (
    <div className="space-y-4">
      <SizePicker
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

      {justAdded ? (
        <div className="space-y-3 rounded-xl border border-brand/40 bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Check className="h-4 w-4 text-brand" />
            اتضاف للسلة — <Num>{formatLength(lengthCm)}</Num>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/cart" className={buttonClasses('primary', 'md', 'w-full')}>
              إتمام الطلب
            </Link>
            <Link href="/" className={buttonClasses('secondary', 'md', 'w-full')}>
              كمّل تسوّق
            </Link>
          </div>
        </div>
      ) : null}

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-app items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">الإجمالي</p>
            <p className="truncate text-lg font-extrabold text-brand">
              <Num>{canAdd ? formatPiastres(total) : '—'}</Num>
            </p>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className={buttonClasses('primary', 'lg', 'flex-1')}
          >
            <ShoppingBag className="h-5 w-5" />
            ضيف للسلة
          </button>
        </div>
      </div>
    </div>
  )
}
