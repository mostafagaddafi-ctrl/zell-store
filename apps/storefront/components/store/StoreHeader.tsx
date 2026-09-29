'use client'

import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import { useCart } from '../../lib/cart'
import { Num } from './Num'

export function StoreHeader({ storeName }: { storeName: string }) {
  const cart = useCart()

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-app items-center justify-between gap-3 px-4">
        <Link href="/" className="text-lg font-extrabold tracking-tight text-brand">
          {storeName}
        </Link>

        <Link
          href="/cart"
          aria-label="السلة"
          className="relative flex h-11 w-11 items-center justify-center rounded-xl text-fg transition-colors hover:bg-card"
        >
          <ShoppingBag className="h-5 w-5" />
          {cart.ready && cart.count > 0 ? (
            <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-fg">
              <Num>{cart.count}</Num>
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  )
}
