'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Minus, Plus, ShoppingBag } from 'lucide-react'
import { formatPiastres } from '@zell/core'
import { useCart } from '../../lib/cart'
import { Button, buttonClasses } from '../ui/Button'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'

/** صف أداة جاهز للعرض — بيتبني على السيرفر من نفس بيانات المتجر المكاشة. */
export type ToolRow = {
  id: number
  name: string
  pricePiastres: number
  compareAtPiastres: number | null
  imageUrl: string | null
  imageAlt: string
  max: number
  /** أسماء الأفلام المناسبة — من الأفلام المعروضة في الصفحة بس. */
  films: string[]
}

/**
 * قايمة أدوات التركيب بعدّاد لكل أداة وزرار إضافة واحد.
 *
 * ⚠️ الإضافة بـ cart.addPiece نفسها: نفس سطر {productId, quantity} ونفس
 *    الهاش ونفس تسعير zell_create_order (السعر × الكمية). مفيش أي حساب جديد.
 * ⚠️ العدّاد مايعدّيش «أقصى كمية − الموجود في السلة»، و addPiece نفسها
 *    مابتعدّيش الحد.
 * ⚠️ مفيش تحويل: «كمّل لإتمام الطلب» و«افتح السلة» ظاهرين دايمًا، فالزبون
 *    يقدر يكمّل من غير أدوات.
 */
export function InstallationToolsList({ rows, checkoutLabel }: { rows: ToolRow[]; checkoutLabel: string }) {
  const cart = useCart()
  const baseId = useId()
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [added, setAdded] = useState(0)

  const inCart = (id: number): number => {
    if (!cart.ready) return 0
    const line = cart.lines.find((item) => item.productId === id && item.quantity !== undefined)
    return line?.quantity ?? 0
  }
  const room = (row: ToolRow): number => Math.max(0, row.max - inCart(row.id))
  const quantityOf = (row: ToolRow): number => Math.min(picked[row.id] ?? 0, room(row))

  const change = (row: ToolRow, next: number) => {
    const clamped = Math.max(0, Math.min(room(row), next))
    setPicked((previous) => ({ ...previous, [row.id]: clamped }))
    setAdded(0)
  }

  // السلة جاهزة وفاضية → «شوف الأفلام» بدل «كمّل لإتمام الطلب» (مفيش حاجة تتطلب). «افتح السلة» ظاهر دايمًا.
  const cartEmpty = cart.ready && cart.count === 0

  const totalQuantity = rows.reduce((sum, row) => sum + quantityOf(row), 0)
  const totalPiastres = rows.reduce((sum, row) => sum + quantityOf(row) * row.pricePiastres, 0)

  const addSelected = () => {
    if (totalQuantity === 0) return
    for (const row of rows) {
      const quantity = quantityOf(row)
      if (quantity > 0) cart.addPiece(row.id, quantity, row.max)
    }
    setAdded(totalQuantity)
    setPicked({})
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {rows.map((row) => {
          const quantity = quantityOf(row)
          const already = inCart(row.id)
          const left = room(row)
          const nameId = baseId + '-tool-' + String(row.id)
          return (
            <li key={row.id} className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <div className="flex gap-3">
                <ImageSlot
                  ratio="1/1"
                  fit="contain"
                  src={row.imageUrl}
                  alt={row.imageAlt}
                  sizes="72px"
                  className="h-[72px] w-[72px] shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p id={nameId} className="line-clamp-2 text-sm font-bold leading-5 text-fg">
                    {row.name}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="font-extrabold text-fg">
                      <Num>{formatPiastres(row.pricePiastres)}</Num>
                    </span>
                    {row.compareAtPiastres !== null ? (
                      <span className="ms-1.5 text-xs text-muted line-through">
                        <Num>{formatPiastres(row.compareAtPiastres)}</Num>
                      </span>
                    ) : null}
                    <span className="ms-1 text-xs text-muted">للوحدة</span>
                  </p>
                  {row.films.length > 0 ? (
                    <p className="mt-1 text-xs text-muted">{'مناسبة لـ: ' + row.films.join(' · ')}</p>
                  ) : null}
                  {already > 0 ? (
                    <p className="mt-1 text-xs font-semibold text-accent">
                      في السلة: <Num>{String(already)}</Num>
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-xs text-muted">{left === 0 ? 'وصلت لأقصى كمية' : 'الكمية'}</span>
                {/* مدمج زي أدوات السلة: الإطار والأيقونات صغيرين بصريًا، ومساحة اللمس 44px عن طريق before */}
                <div role="group" aria-labelledby={nameId} className="flex items-center gap-0.5 rounded border border-border">
                  <button
                    type="button"
                    aria-label={'قلّل ' + row.name}
                    disabled={quantity <= 0}
                    onClick={() => change(row, quantity - 1)}
                    className="relative flex h-8 w-8 items-center justify-center rounded text-muted transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-border/40 hover:text-fg disabled:opacity-40"
                  >
                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <output aria-live="polite" className="min-w-[2.5rem] text-center text-sm font-bold text-fg">
                    <Num>{String(quantity)}</Num>
                  </output>
                  <button
                    type="button"
                    aria-label={'زوّد ' + row.name}
                    disabled={quantity >= left}
                    onClick={() => change(row, quantity + 1)}
                    className="relative flex h-8 w-8 items-center justify-center rounded text-muted transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-border/40 hover:text-fg disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Button size="lg" onClick={addSelected} disabled={totalQuantity === 0}>
          <ShoppingBag className="h-5 w-5" aria-hidden="true" />
          {totalQuantity === 0 ? (
            'اختار الكمية الأول'
          ) : (
            <>
              {'ضيف للسلة · '}
              <Num>{formatPiastres(totalPiastres)}</Num>
            </>
          )}
        </Button>

        {added > 0 ? (
          <p role="status" className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Check className="h-4 w-4 text-accent" aria-hidden="true" />
            اتضاف للسلة — الكمية <Num>{String(added)}</Num>
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          {cartEmpty ? (
            <Link href="/products" className={buttonClasses('primary', 'md', 'w-full')}>
              شوف الأفلام
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <Link href="/checkout" className={buttonClasses('primary', 'md', 'w-full')}>
              {checkoutLabel}
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <Link href="/cart" className={buttonClasses('secondary', 'md', 'w-full')}>
            افتح السلة
          </Link>
        </div>
      </div>
    </div>
  )
}
