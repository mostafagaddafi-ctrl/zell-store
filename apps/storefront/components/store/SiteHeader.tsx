'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageCircle, PackageSearch, ShoppingBag } from 'lucide-react'
import type { SocialLink, StoreCollection } from '@zell/core'
import { useCart } from '../../lib/cart'
import { cn } from '../../lib/cn'
import { buildDesktopNav, cartBadge, cartLabel, type HomeHelpVisibility } from '../../lib/nav/storeNav'
import { Container } from '../ui/Container'
import { HeaderWordmark } from './HeaderWordmark'
import { MobileMenu } from './MobileMenu'
import { Num } from './Num'

/**
 * هيدر المتجر — **موبايل أولًا**.
 *
 * الموبايل والتابلت (تحت lg): لوجو · [سلة] · [همبرجر]
 * الكمبيوتر (من lg): لوجو · روابط الأقسام · استفسار بنصّه · تتبّع طلبك · سلة
 *
 * الأقسام هنا المفعّلة في القائمة بس (showInNav)، بترتيب اللوحة.
 * لو أكتر من DESKTOP_LINKS: أول (DESKTOP_LINKS - 1) + «كل الأقسام»
 * لصفحة /collections — مفيش قسم بيختفي من غير مدخل. المنطق والتمييز في
 * `lib/nav/storeNav.ts` (STORE-MENU §٣ و§٤).
 *
 * ⚠️ STORE-MENU §٣ و§١٥: شكل الكمبيوتر بقى من `lg` (1024px) بدل `md`، علشان
 *    «تتبّع طلبك» بنصّه ماينفعش يدخل عند 768px من غير ما أسماء الأقسام تتقص لدرجة
 *    إنها ماتتفهمش. روابط الهيدر وزرار القائمة والـ dialog بيتنقلوا مع بعض (مفيش
 *    مقاس من غير تنقّل). حشو الصفحة تحت و`WhatsAppFab` لسه على `md`.
 *
 * ⚠️ رابط «استفسار» **مخفي تمامًا** تحت lg (hidden lg:flex)، مش
 *    النص بس. الأيقونة لوحدها جنب السلة كانت لغز: أيقونتين متجاورتين
 *    من غير نص، وواحدة بتخرج من الموقع. التواصل على الموبايل مكانه
 *    الزرار العائم وجزء «المساعدة» في قائمة الموبايل، والاتنين بنصّهم الكامل.
 *
 * اللوجو: «my» + «ظل» (LOGO-TEXT، قرار المالك 2026-10-27 — HeaderWordmark و`lib/brand/headerWordmark.ts`)،
 * مش صورة site_images. صورة اللوجو المرفوعة من اللوحة مابقتش بتظهر في الهيدر، ومااتمسحتش.
 */
export function SiteHeader({
  storeName,
  collections,
  whatsappNumber,
  whatsappMessage,
  allLabel,
  social,
  toolsLink = null,
  help,
}: {
  storeName: string
  collections: StoreCollection[]
  whatsappNumber: string
  whatsappMessage: string
  /** اسم رابط «كل المنتجات» من اللوحة — فاضي = الرابط مخفي. */
  allLabel: string
  /** روابط السوشيال — بتظهر تحت في قائمة الموبايل. */
  social: SocialLink[]
  /** لينك صفحة «أدوات التركيب» في قائمة الموبايل — null = مخفي. */
  toolsLink?: { href: string; label: string } | null
  /** STORE-MENU §٥ — ظهور «إزاي أطلب» و«الأسئلة المتكررة» في قائمة الموبايل (نفس شرط الرئيسية). */
  help: HomeHelpVisibility
}) {
  const cart = useCart()
  const pathname = usePathname()
  // أيقونة السلة: إجمالي الكمية (سطر المتر = ١، والمنتج بالعدد = كميته)
  const items = cart.itemCount
  const cartAriaLabel = cartLabel(cart.ready, items)
  const badge = cartBadge(cart.ready, items)
  // نبضة خفيفة لما الكمية تزيد بس — مش وقت فتح الصفحة، ومش مع تقليل الحركة
  const [bump, setBump] = useState(false)
  const previousItems = useRef<number | null>(null)
  const bumpTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!cart.ready) return
    const previous = previousItems.current
    previousItems.current = items
    if (previous === null || items <= previous) return
    setBump(true)
    window.clearTimeout(bumpTimer.current)
    bumpTimer.current = window.setTimeout(() => setBump(false), 220)
  }, [cart.ready, items])
  useEffect(() => () => window.clearTimeout(bumpTimer.current), [])
  const navCollections = collections.filter((collection) => collection.showInNav)
  const desktop = buildDesktopNav({ pathname, allLabel, collections: navCollections })
  const whatsappHref = whatsappNumber
    ? 'https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(whatsappMessage || '')
    : null

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 shadow-[0_1px_10px_hsl(var(--brand)/0.06)] backdrop-blur-md">
      <Container className="flex h-16 items-center gap-2 sm:h-[4.5rem]">
        <Link href="/" aria-label={storeName} className="flex h-12 w-20 shrink-0 items-center overflow-hidden sm:w-24">
          <HeaderWordmark />
        </Link>

        {/* روابط الكمبيوتر — لو الأقسام كتير، «كل الأقسام» بيوصل للباقي */}
        <nav aria-label="أقسام المتجر" className="hidden min-w-0 flex-1 lg:flex lg:items-center lg:gap-1">
          {allLabel ? (
            <Link
              href="/products"
              aria-current={desktop.allCurrent ? 'page' : undefined}
              className={cn(
                'shrink-0 rounded-lg px-3 py-2 text-sm transition-colors hover:text-accent',
                desktop.allCurrent ? 'font-bold text-brand' : 'font-medium text-fg',
              )}
            >
              {allLabel}
            </Link>
          ) : null}
          {desktop.links.map((link) => (
            <Link
              key={link.slug}
              href={link.href}
              title={link.title}
              aria-current={link.current ? 'page' : undefined}
              className={cn(
                'min-w-0 max-w-[11rem] truncate rounded-lg px-3 py-2 text-sm transition-colors hover:text-accent',
                link.current ? 'font-bold text-brand' : 'font-medium text-fg',
              )}
            >
              {link.title}
            </Link>
          ))}
          {desktop.overflow !== null ? (
            <Link
              href="/collections"
              // aria-current على /collections بس؛ جوه قسم مخفي = تلوين خفيف من غير aria-current (STORE-MENU §٤)
              aria-current={desktop.overflow.current ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:text-brand',
                desktop.overflow.current ? 'font-bold text-brand' : desktop.overflow.containsCurrent ? 'bg-brand/5 text-brand' : 'text-accent',
              )}
            >
              كل الأقسام
              <span className="text-xs font-medium text-muted">
                (<Num>{desktop.overflow.count}</Num>)
              </span>
            </Link>
          ) : null}
        </nav>

        <div className="ms-auto flex items-center gap-1">
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-fg transition-colors hover:text-accent lg:flex"
            >
              <MessageCircle className="h-5 w-5" />
              استفسار
            </a>
          ) : null}

          {/* STORE-MENU §٣ — «تتبّع طلبك» بنصّه جنب السلة (الكمبيوتر بس؛ على الموبايل في القائمة) */}
          <Link
            href="/track"
            aria-current={desktop.trackCurrent ? 'page' : undefined}
            className={cn(
              'hidden h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors hover:text-accent lg:flex',
              desktop.trackCurrent ? 'font-bold text-brand' : 'font-medium text-fg',
            )}
          >
            <PackageSearch className="h-5 w-5" aria-hidden="true" />
            تتبّع طلبك
          </Link>

          <Link
            href="/cart"
            aria-label={cartAriaLabel}
            aria-current={desktop.cartCurrent ? 'page' : undefined}
            className={cn(
              'relative flex h-11 w-11 items-center justify-center rounded-lg border bg-card transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              desktop.cartCurrent ? 'border-brand text-brand' : 'border-border text-fg',
            )}
          >
            <ShoppingBag className="h-6 w-6" aria-hidden="true" />
            {badge !== null ? (
              <span
                aria-hidden="true"
                className={
                  'pointer-events-none absolute -left-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-brand-fg ring-2 ring-bg motion-safe:transition-transform motion-safe:duration-200' +
                  (bump ? ' motion-safe:scale-125' : '')
                }
              >
                <Num>{badge}</Num>
              </span>
            ) : null}
          </Link>

          <MobileMenu
            collections={navCollections}
            whatsappHref={whatsappHref}
            allLabel={allLabel}
            social={social}
            toolsLink={toolsLink}
            help={help}
          />
        </div>
      </Container>
    </header>
  )
}
