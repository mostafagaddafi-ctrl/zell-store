'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2, Minus, Plus, ShoppingBag } from 'lucide-react'
import { formatPiastres, maxQuantityOf, type StoreProduct } from '@zell/core'
import { useCart } from '../../lib/cart'
import { BUY_NOW_PENDING_TEXT } from '../../lib/buy/buyNow'
import { BuyNowSlowNotice } from './BuyNowSlowNotice'
import { useBuyNow } from './useBuyNow'
import { Button, buttonClasses } from '../ui/Button'
import { Num } from './Num'

/**
 * صفحة منتج القطعة (0016) — عدد بدل مقاسات. نفس أزرار «اطلب دلوقتي» و«ضيف للسلة».
 * السعر هنا للعرض بس — zell_create_order بتسعّر من الداتابيز (السعر × العدد).
 */
export function PieceBuy({ product }: { product: StoreProduct }) {
  const cart = useCart()
  // BUY-NOW — «اطلب دلوقتي»: إضافة مرة واحدة + علامة تحميل فورية + منع الضغط المتكرر (lib/buy/buyNow.ts)
  const buyNow = useBuyNow()
  const busy = buyNow.busy
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

  // لو نفس الكمية اتضافت لسه (justAdded) مابيضيفهاش تاني — يروح بس (السلوك القديم).
  const handleBuyNow = () => {
    buyNow.go(String(quantity), justAdded, () => cart.addPiece(product.id, quantity, max))
  }

  return (
    <div className="space-y-4">
      {/* BUY-NOW: وقت «اطلب دلوقتي» كل الاختيارات والأزرار مقفولة لحد ما الانتقال يتحسم — اللي ظاهر = اللي اتضاف */}
      <fieldset disabled={busy} className="min-w-0 space-y-4">
      {/* صف مدمج: الكمية بأزرار كبيرة للموبايل (٤٤px)، وتحتها سعر الوحدة والإجمالي */}
      <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="piece-quantity-label" className="text-sm font-bold text-fg">الكمية</h2>
          <div role="group" aria-labelledby="piece-quantity-label" className="flex items-center gap-1 rounded-lg border border-border p-1">
            <button
              type="button"
              aria-label="قلّل الكمية"
              disabled={quantity <= 1}
              onClick={() => change(quantity - 1)}
              className="flex h-11 w-11 items-center justify-center rounded text-fg transition-colors hover:bg-bg disabled:opacity-40"
            >
              <Minus className="h-5 w-5" />
            </button>
            <output aria-live="polite" className="min-w-[2.75rem] text-center text-lg font-extrabold text-fg">
              <Num>{String(quantity)}</Num>
            </output>
            <button
              type="button"
              aria-label="زوّد الكمية"
              disabled={quantity >= max}
              onClick={() => change(quantity + 1)}
              className="flex h-11 w-11 items-center justify-center rounded text-fg transition-colors hover:bg-bg disabled:opacity-40"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>
        <dl className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
          <div>
            <dt className="text-xs text-muted">سعر الوحدة</dt>
            <dd className="text-sm font-bold text-fg">
              <Num>{formatPiastres(product.price_per_meter_piastres)}</Num>
            </dd>
          </div>
          <div className="text-end">
            <dt className="text-xs text-muted">الإجمالي</dt>
            <dd className="text-base font-extrabold text-brand">
              <Num>{formatPiastres(total)}</Num>
            </dd>
          </div>
        </dl>
      </div>

      {/* نفس أولوية صفحة الفيلم: «ضيف للسلة» الأساسي وفوق، و«اطلب دلوقتي» تحته ثانوي */}
      <div className="grid gap-2">
        <Button size="lg" onClick={handleAdd} disabled={busy}>
          <ShoppingBag className="h-5 w-5" />
          ضيف للسلة
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={handleBuyNow}
          disabled={busy}
          aria-busy={busy}
          className={busy ? 'disabled:cursor-wait disabled:opacity-100' : undefined}
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {BUY_NOW_PENDING_TEXT}
            </>
          ) : (
            <>
              اطلب دلوقتي
              <ArrowLeft className="h-5 w-5" />
            </>
          )}
        </Button>
      </div>
      </fieldset>

      {/* BUY-NOW: بعد 15 ثانية تنبيه (مش فشل) + تحميل كامل لصفحة البيانات — برّه الـ fieldset علشان يفضل شغّال */}
      <BuyNowSlowNotice phase={buyNow.phase} onRetry={buyNow.retry} />

      {justAdded ? (
        <div className="space-y-3 rounded-lg border border-accent/40 bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Check className="h-4 w-4 text-accent" />
            اتضاف للسلة — الكمية <Num>{String(quantity)}</Num>
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
