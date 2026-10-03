'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Minus, Plus, ShoppingBag } from 'lucide-react'
import { formatPiastres, maxQuantityOf, type StoreProduct } from '@zell/core'
import { useCart } from '../../lib/cart'
import { Button, buttonClasses } from '../ui/Button'
import { Num } from './Num'

/**
 * صفحة منتج القطعة (0016) — عدد بدل مقاسات. نفس أزرار «اطلب دلوقتي» و«ضيف للسلة».
 * السعر هنا للعرض بس — zell_create_order بتسعّر من الداتابيز (السعر × العدد).
 */
export function PieceBuy({ product }: { product: StoreProduct }) {
  const cart = useCart()
  const router = useRouter()
  const max = maxQuantityOf(product)
  const [quantity, setQuantity] = useState(1)
  const [justAdded, setJustAdded] = useState(false)
  const total = product.price_per_meter_piastres * quantity

  const change = (next: number) => {
    if (next < 1 || next > max) return
    setQuantity(next)
    setJustAdded(false)
  }

  const handleAdd = () => {
    cart.addPiece(product.id, quantity, max)
    setJustAdded(true)
  }

  const handleBuyNow = () => {
    if (!justAdded) cart.addPiece(product.id, quantity, max)
    router.push('/checkout')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="text-base font-bold text-fg">العدد</h2>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border p-2">
          <button
            type="button"
            aria-label="قلّل العدد"
            disabled={quantity <= 1}
            onClick={() => change(quantity - 1)}
            className="flex h-12 w-12 items-center justify-center rounded border border-border text-fg transition-colors hover:border-muted disabled:opacity-40"
          >
            <Minus className="h-5 w-5" />
          </button>
          <p className="text-xl font-extrabold text-fg">
            <Num>{String(quantity)}</Num> قطعة
          </p>
          <button
            type="button"
            aria-label="زوّد العدد"
            disabled={quantity >= max}
            onClick={() => change(quantity + 1)}
            className="flex h-12 w-12 items-center justify-center rounded border border-border text-fg transition-colors hover:border-muted disabled:opacity-40"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-bg px-3 py-2.5">
          <span className="text-sm text-muted">السعر</span>
          <span className="text-base font-extrabold text-brand">
            <Num>{formatPiastres(total)}</Num>
          </span>
        </div>
      </div>

      <div className="grid gap-2">
        <Button size="lg" onClick={handleBuyNow}>
          اطلب دلوقتي
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Button size="lg" variant="secondary" onClick={handleAdd}>
          <ShoppingBag className="h-5 w-5" />
          ضيف للسلة
        </Button>
      </div>

      {justAdded ? (
        <div className="space-y-3 rounded-lg border border-accent/40 bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Check className="h-4 w-4 text-accent" />
            اتضاف للسلة — <Num>{String(quantity)}</Num> قطعة
          </p>
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
        </div>
      ) : null}
    </div>
  )
}
