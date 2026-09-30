'use client'

import Link from 'next/link'
import { MessageCircle, ShoppingBag } from 'lucide-react'
import type { StoreImage } from '@zell/core'
import { useCart } from '../../lib/cart'
import { Container } from '../ui/Container'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'

/**
 * اللوجو بيتقرا من site_images (kind = 'logo' and is_active = true).
 * الملف الأصلي مربع 1024×1024، فبيتعرض في خانة مربعة بـ contain.
 * لو مفيش لوجو نشط: اسم المتجر كنص عادي — احتياطي مش wordmark مصمّم.
 */
export function SiteHeader({
  storeName,
  logo,
  whatsappNumber,
  whatsappMessage,
}: {
  storeName: string
  logo: StoreImage | null
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
        <Link href="/" aria-label={storeName} className="flex shrink-0 items-center">
          {logo ? (
            <ImageSlot
              ratio="1/1"
              fit="contain"
              src={logo.url}
              alt={logo.alt || storeName}
              sizes="44px"
              priority
              className="h-11 w-11 bg-transparent"
              imageClassName="p-0"
            />
          ) : (
            <span className="text-base font-semibold text-brand">{storeName}</span>
          )}
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
