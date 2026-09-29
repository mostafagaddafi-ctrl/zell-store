'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useCart } from '../../lib/cart'
import { Num } from './Num'

/** شريط ثابت تحت — الطريق للسلة من أي مكان في الصفحة من غير scroll لفوق. */
export function CartBar() {
  const cart = useCart()
  if (!cart.ready || cart.count === 0) return null

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur">
      <Link
        href="/cart"
        className="mx-auto flex h-14 max-w-app items-center justify-between rounded-xl bg-brand px-5 font-semibold text-brand-fg"
      >
        <span>
          السلة (<Num>{cart.count}</Num>)
        </span>
        <span className="flex items-center gap-2">
          إتمام الطلب
          <ArrowLeft className="h-4 w-4" />
        </span>
      </Link>
    </div>
  )
}
