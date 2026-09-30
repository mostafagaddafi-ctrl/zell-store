'use client'

import Link from 'next/link'
import { MessageCircle, ShoppingBag } from 'lucide-react'
import { useCart } from '../../lib/cart'
import { Container } from '../ui/Container'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'

/**
 * اللوجو الحقيقي هيتوصل لاحقًا. لحد كده الخانة بتعرض اسم المتجر كنص عادي
 * — ده احتياطي مش wordmark مصمّم، وبيتشال أول ما src يتمرر.
 */
export function SiteHeader({
  storeName,
  logoUrl,
  whatsappNumber,
  whatsappMessage,
}: {
  storeName: string
  logoUrl: string
  whatsappNumber: string
  whatsappMessage: string
}) {
  const cart = useCart()
  const whatsappHref = whatsappNumber
    ? 'https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(whatsappMessage || '')
    : null

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label={storeName} className="shrink-0">
          <ImageSlot
            ratio="auto"
            src={logoUrl || null}
            alt={storeName}
            width={112}
            height={36}
            label={storeName}
            labelClassName="text-base font-semibold text-brand"
            className="h-9 w-28 bg-transparent"
          />
        </Link>

        <div className="flex items-center gap-1">
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-fg transition-colors hover:text-accent"
            >
              <MessageCircle className="h-5 w-5" />
              <span className="hidden sm:inline">استفسار</span>
            </a>
          ) : null}

          <Link
            href="/cart"
            aria-label="السلة"
            className="relative flex h-11 w-11 items-center justify-center rounded-lg text-fg transition-colors hover:text-accent"
          >
            <ShoppingBag className="h-5 w-5" />
            {cart.ready && cart.count > 0 ? (
              <span className="absolute right-1 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-brand-fg">
                <Num>{cart.count}</Num>
              </span>
            ) : null}
          </Link>
        </div>
      </Container>
    </header>
  )
}
