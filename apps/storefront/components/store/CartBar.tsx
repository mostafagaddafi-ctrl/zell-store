'use client'

import Link from 'next/link'
import { ArrowLeft, ShoppingBag } from 'lucide-react'
import { useCart } from '../../lib/cart'
import { Num } from './Num'

/**
 * شريط ثابت تحت — من أي مكان في الصفحة من غير scroll لفوق.
 * نصين: «السلة» لمراجعة الأصناف، و«إتمام الطلب» للبيانات على طول.
 */
export function CartBar() {
  const cart = useCart()
  if (!cart.ready || cart.count === 0) return null

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-app items-stretch gap-2">
        <Link
          href="/cart"
          className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-4 font-semibold text-fg"
        >
          <ShoppingBag className="h-5 w-5" />
          <span>
            السلة (<Num>{cart.count}</Num>)
          </span>
        </Link>
        <Link
          href="/checkout"
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-brand-fg"
        >
          إتمام الطلب
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}
