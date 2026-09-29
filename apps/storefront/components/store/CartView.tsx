'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { computeSubtotalPiastres, formatLength, formatPiastres, type StoreProduct } from '@zell/core'
import { useCart } from '../../lib/cart'
import { buttonClasses } from '../ui/Button'
import { FilmArt, variantForProduct } from './FilmArt'
import { Num } from './Num'

export function CartView({ products }: { products: StoreProduct[] }) {
  const cart = useCart()
  const [pruned, setPruned] = useState(false)

  const byId = useMemo(() => {
    const map = new Map<number, StoreProduct>()
    for (const product of products) map.set(product.id, product)
    return map
  }, [products])

  // منتج اتقفل أو اتشال؟ نظّف السلة مرة واحدة بعد القراءة
  useEffect(() => {
    if (!cart.ready || pruned) return
    for (const line of cart.lines) {
      if (!byId.has(line.productId)) cart.remove(line.id)
    }
    setPruned(true)
  }, [cart, byId, pruned])

  if (!cart.ready) {
    return <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
  }

  const entries = cart.lines
    .map((line) => ({ line, product: byId.get(line.productId) }))
    .filter((entry): entry is { line: (typeof cart.lines)[number]; product: StoreProduct } => Boolean(entry.product))

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card py-12 text-center">
        <ShoppingBag className="mx-auto h-10 w-10 text-muted" />
        <p className="mt-3 text-sm text-muted">السلة فاضية — اختار نوع الفيلم وحدد المقاس.</p>
        <Link href="/" className={buttonClasses('primary', 'md', 'mt-4 inline-flex')}>
          شوف الأنواع
        </Link>
      </div>
    )
  }

  const subtotal = entries.reduce(
    (sum, entry) => sum + computeSubtotalPiastres(entry.product.price_per_meter_piastres, entry.line.lengthCm),
    0,
  )

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {entries.map((entry) => {
          const lineTotal = computeSubtotalPiastres(entry.product.price_per_meter_piastres, entry.line.lengthCm)
          const stepBy = (delta: number) => {
            const next = entry.line.lengthCm + delta * entry.product.step_cm
            if (next < entry.product.min_length_cm || next > entry.product.max_length_cm) return
            cart.setLength(entry.line.id, next)
          }

          return (
            <li key={entry.line.id} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex gap-3">
                <FilmArt
                  variant={variantForProduct(entry.product.name_ar, entry.product.name_en)}
                  className="h-20 w-20 shrink-0"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-sm font-bold text-fg">{entry.product.name_ar}</h3>
                    <button
                      type="button"
                      onClick={() => cart.remove(entry.line.id)}
                      aria-label="شيل الصنف"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <p className="mt-0.5 text-xs text-muted">
                    <Num>{formatPiastres(entry.product.price_per_meter_piastres)}</Num> للمتر
                  </p>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => stepBy(-1)}
                        aria-label="قلّل"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-fg"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-20 text-center text-sm font-semibold text-fg">
                        <Num>{formatLength(entry.line.lengthCm)}</Num>
                      </span>
                      <button
                        type="button"
                        onClick={() => stepBy(1)}
                        aria-label="زوّد"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-fg"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>

                    <span className="text-sm font-extrabold text-brand">
                      <Num>{formatPiastres(lineTotal)}</Num>
                    </span>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">إجمالي الأصناف</span>
          <span className="font-bold text-fg">
            <Num>{formatPiastres(subtotal)}</Num>
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">الشحن بيتحسب بعد اختيار المحافظة.</p>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur">
        <Link href="/checkout" className={buttonClasses('primary', 'lg', 'mx-auto max-w-app')}>
          كمّل بيانات التوصيل
        </Link>
      </div>
    </div>
  )
}
