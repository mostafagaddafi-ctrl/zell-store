'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { MessageCircle, ShoppingBag } from 'lucide-react'
import type { SocialLink, StoreCollection, StoreImage } from '@zell/core'
import { useCart } from '../../lib/cart'
import { Container } from '../ui/Container'
import { LogoWordmark } from './Logo'
import { MobileMenu } from './MobileMenu'
import { Num } from './Num'

/**
 * هيدر المتجر — **موبايل أولًا**.
 *
 * الموبايل: لوجو · [سلة] · [همبرجر]
 * الديسكتوب: لوجو · روابط الأقسام · استفسار بنصّه · سلة
 *
 * الأقسام هنا المفعّلة في القائمة بس (showInNav)، بترتيب اللوحة.
 * لو أكتر من DESKTOP_LINKS: أول (DESKTOP_LINKS - 1) + «كل الأقسام»
 * لصفحة /collections — مفيش قسم بيختفي من غير مدخل.
 *
 * ⚠️ رابط «استفسار» **مخفي تمامًا** على الموبايل (hidden md:flex)، مش
 *    النص بس. الأيقونة لوحدها جنب السلة كانت لغز: أيقونتين متجاورتين
 *    من غير نص، وواحدة بتخرج من الموقع. التواصل على الموبايل مكانه
 *    الزرار العائم وآخر قائمة الموبايل، والاتنين بنصّهم الكامل.
 *
 * اللوجو من site_images (kind = 'logo' and is_active = true). الخانة
 * ارتفاع ثابت وعرض حر بحد أقصى، و object-contain يمنع أي تشويه.
 */
const DESKTOP_LINKS = 4

export function SiteHeader({
  storeName,
  logo,
  collections,
  whatsappNumber,
  whatsappMessage,
  allLabel,
  social,
  toolsLink = null,
}: {
  storeName: string
  logo: StoreImage | null
  collections: StoreCollection[]
  whatsappNumber: string
  whatsappMessage: string
  /** اسم رابط «كل المنتجات» من اللوحة — فاضي = الرابط مخفي. */
  allLabel: string
  /** روابط السوشيال — بتظهر تحت في قائمة الموبايل. */
  social: SocialLink[]
  /** لينك صفحة «أدوات التركيب» في قائمة الموبايل — null = مخفي. */
  toolsLink?: { href: string; label: string } | null
}) {
  const cart = useCart()
  // أيقونة السلة: إجمالي الكمية (سطر المتر = ١، والمنتج بالعدد = كميته)
  const items = cart.itemCount
  const cartLabel = !cart.ready ? 'السلة' : items === 0 ? 'السلة — فاضية' : 'السلة — فيها ' + itemsPhrase(items)
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
  const overflow = navCollections.length > DESKTOP_LINKS
  const desktopLinks = overflow ? navCollections.slice(0, DESKTOP_LINKS - 1) : navCollections
  const whatsappHref = whatsappNumber
    ? 'https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(whatsappMessage || '')
    : null

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 shadow-[0_1px_10px_hsl(var(--brand)/0.06)] backdrop-blur-md">
      <Container className="flex h-16 items-center gap-2 sm:h-[4.5rem]">
        <Link href="/" aria-label={storeName} className="flex h-12 w-20 shrink-0 items-center overflow-hidden sm:w-24">
          {logo ? (
            <Image
              src={logo.url}
              alt={logo.alt || storeName}
              width={160}
              height={40}
              priority
              className="h-12 w-full object-contain mix-blend-multiply sm:h-14"
            />
          ) : (
            <>
              {/* من غير لوجو مرفوع: الاسم الكامل (العلامة + الاسم) جوه نفس الخانة — 15px على الموبايل و18px من sm */}
              <LogoWordmark name={storeName} size={15} className="sm:hidden" />
              <LogoWordmark name={storeName} size={18} className="hidden sm:inline-flex" />
            </>
          )}
        </Link>

        {/* روابط الديسكتوب — لو الأقسام كتير، «كل الأقسام» بيوصل للباقي */}
        <nav aria-label="أقسام المتجر" className="hidden min-w-0 flex-1 md:flex md:items-center md:gap-1">
          {allLabel ? (
            <Link
              href="/products"
              className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors hover:text-accent"
            >
              {allLabel}
            </Link>
          ) : null}
          {desktopLinks.map((collection) => (
            <Link
              key={collection.slug}
              href={'/collection/' + collection.slug}
              title={collection.title}
              className="min-w-0 max-w-[11rem] truncate rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors hover:text-accent"
            >
              {collection.title}
            </Link>
          ))}
          {overflow ? (
            <Link
              href="/collections"
              className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-accent transition-colors hover:text-brand"
            >
              كل الأقسام
              <span className="text-xs font-medium text-muted">
                (<Num>{navCollections.length}</Num>)
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
              className="hidden h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-fg transition-colors hover:text-accent md:flex"
            >
              <MessageCircle className="h-5 w-5" />
              استفسار
            </a>
          ) : null}

          <Link
            href="/cart"
            aria-label={cartLabel}
            className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-fg transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <ShoppingBag className="h-6 w-6" aria-hidden="true" />
            {cart.ready && items > 0 ? (
              <span
                aria-hidden="true"
                className={
                  'pointer-events-none absolute -left-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-brand-fg ring-2 ring-bg motion-safe:transition-transform motion-safe:duration-200' +
                  (bump ? ' motion-safe:scale-125' : '')
                }
              >
                <Num>{items > 99 ? '99+' : String(items)}</Num>
              </span>
            ) : null}
          </Link>

          <MobileMenu collections={navCollections} whatsappHref={whatsappHref} allLabel={allLabel} social={social} toolsLink={toolsLink} />
        </div>
      </Container>
    </header>
  )
}

/** «منتج واحد» · «منتجين» · «٣ منتجات» (٣–١٠) · «١١ منتج» (١١+). العدد الحقيقي — من غير 99+. */
function itemsPhrase(count: number): string {
  if (count === 1) return 'منتج واحد'
  if (count === 2) return 'منتجين'
  if (count <= 10) return String(count) + ' منتجات'
  return String(count) + ' منتج'
}
