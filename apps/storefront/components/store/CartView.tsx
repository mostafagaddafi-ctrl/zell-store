'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import {
  describeLine,
  formatPiastres,
  isPiece,
  lineTotalPiastres,
  maxQuantityOf,
  primaryImage,
  resolveCartLine,
  widthOptionsOf,
  type StoreProduct,
} from '@zell/core'
import { useCart } from '../../lib/cart'
import { buttonClasses } from '../ui/Button'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'
import { OrderSummary } from './OrderSummary'

export function CartView({
  products,
  trustLine,
  gift,
}: {
  products: StoreProduct[]
  trustLine?: string
  gift?: string
}) {
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
      const base = byId.get(line.productId)
      // 0015 — عرض اتشال أو اتوقف = الصنف مش متاح
      if (!base || !resolveCartLine(base, line)) cart.remove(line.id)
    }
    setPruned(true)
  }, [cart, byId, pruned])

  if (!cart.ready) {
    return <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
  }

  const entries = cart.lines
    .map((line) => {
      const base = byId.get(line.productId)
      return {
        line,
        product: base ? (resolveCartLine(base, line) ?? undefined) : undefined,
        multi: base ? widthOptionsOf(base).length > 1 : false,
      }
    })
    .filter(
      (entry): entry is { line: (typeof cart.lines)[number]; product: StoreProduct; multi: boolean } =>
        Boolean(entry.product),
    )

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
        <ShoppingBag className="mx-auto h-8 w-8 text-muted" />
        <p className="mt-4 text-sm text-muted">السلة فاضية — اختار نوع الفيلم وحدد المقاس.</p>
        <Link href="/" className={buttonClasses('primary', 'md', 'mt-5 inline-flex')}>
          شوف الأنواع
        </Link>
      </div>
    )
  }

  const subtotal = entries.reduce(
    (sum, entry) => sum + lineTotalPiastres(entry.product, entry.line),
    0,
  )

  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
      <ul className="space-y-3 lg:col-span-7">
        {entries.map((entry) => {
          const lineTotal = lineTotalPiastres(entry.product, entry.line)
          const preview = primaryImage(entry.product)
          const stepBy = (delta: number) => {
            // 0016 — القطعة: العدد من ١ لأقصى عدد
            if (isPiece(entry.product)) {
              const next = (entry.line.quantity ?? 1) + delta
              if (next < 1 || next > maxQuantityOf(entry.product)) return
              cart.setQuantity(entry.line.id, next)
              return
            }
            const next = entry.line.lengthCm + delta * entry.product.step_cm
            if (next < entry.product.min_length_cm || next > entry.product.max_length_cm) return
            cart.setLength(entry.line.id, next)
          }

          return (
            <li key={entry.line.id} className="flex gap-4 rounded-lg border border-border bg-card p-3 sm:p-4">
              <Link href={'/product/' + String(entry.product.id)} className="shrink-0">
                <ImageSlot
                  ratio="1/1"
                  fit="cover"
                  src={preview?.url ?? null}
                  alt={preview?.alt ?? entry.product.name_ar}
                  sizes="96px"
                  className="h-24 w-24"
                />
              </Link>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={'/product/' + String(entry.product.id)}
                      className="block truncate text-sm font-bold text-fg hover:text-accent"
                    >
                      {entry.product.name_ar}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      <Num>{formatPiastres(entry.product.price_per_meter_piastres)}</Num> {isPiece(entry.product) ? 'للقطعة' : 'للمتر'}
                      {entry.multi ? (
                        <>
                          {' · عرض '}
                          <Num>{String(entry.product.width_cm)}</Num>
                          {' سم'}
                        </>
                      ) : null}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => cart.remove(entry.line.id)}
                    aria-label="شيل الصنف"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1">
                    <StepButton onClick={() => stepBy(-1)} label="قلّل">
                      <Minus className="h-4 w-4" />
                    </StepButton>
                    <span className="min-w-[5.5rem] text-center text-sm font-semibold text-fg">
                      <Num>{describeLine(entry.product, entry.line)}</Num>
                    </span>
                    <StepButton onClick={() => stepBy(1)} label="زوّد">
                      <Plus className="h-4 w-4" />
                    </StepButton>
                  </div>

                  <span className="text-base font-extrabold text-fg">
                    <Num>{formatPiastres(lineTotal)}</Num>
                  </span>
                </div>
              </div>
            </li>
          )
        })}

        <li>
          <Link href="/" className="inline-block py-2 text-sm font-semibold text-accent">
            + ضيف نوع تاني
          </Link>
        </li>
      </ul>

      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-24">
          <OrderSummary
            trustLine={trustLine}
            gift={gift}
            subtotalPiastres={subtotal}
            shippingPiastres={null}
            action={
              <Link href="/checkout" className={buttonClasses('primary', 'lg')}>
                كمّل بيانات التوصيل
              </Link>
            }
          />
        </div>
      </div>
    </div>
  )
}

function StepButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded border border-border text-fg transition-colors hover:border-muted"
    >
      {children}
    </button>
  )
}
