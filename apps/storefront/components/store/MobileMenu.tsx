'use client'

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, MessageCircle, PackageSearch, ShoppingBag, X } from 'lucide-react'
import type { SocialLink, StoreCollection } from '@zell/core'
import { useCart } from '../../lib/cart'
import { cn } from '../../lib/cn'
import { buildMobileMenu, cartBadge, cartLabel, type HomeHelpVisibility, type MenuItem } from '../../lib/nav/storeNav'
import { Num } from './Num'
import { SocialLinks } from './SocialLinks'

/**
 * قائمة الموبايل — Drawer كامل الارتفاع من شمال الشاشة — نفس ناحية زرار القائمة.
 *
 * ⚠️ مبنية على `<dialog>` + showModal() عن قصد: حصر التركيز، Escape،
 *    inert للخلفية، والطبقة العليا (فمفيش قص من الهيدر ولا معركة
 *    z-index) — كلها من المتصفح. مفيش dropdown يدوي ومفيش مكتبة جديدة.
 *
 * ⚠️ الموضع والمقاس والـoverlay في `.zell-drawer` في globals.css، **مش**
 *    هنا. السبب مكتوب جمب القواعد: UA stylesheet بيفرض max-height
 *    على أي dialog، وكلاس Tailwind للـheight مابيلغيهوش — فاللوحة
 *    كانت بتتقص. ممنوع نرجّع الموضع لكلاسات هنا.
 *
 * ⚠️ الحالة في React **مش** مصدر الحقيقة للفتح: المتصفح بيقفل الحوار
 *    لوحده بـEscape. عشان كده بنسمع onClose ونزامن منه.
 *
 * STORE-MENU (docs/contracts/STORE-MENU.md §٢): أربع أجزاء — الاختصارات (السلة · تتبّع طلبك) ← التصفّح
 * (كل المنتجات · «الأقسام» · الأدوات تحتها على طول) ← «المساعدة» ← الرئيسية والسوشيال تحت. الأجزاء والشروط والتمييز
 * من `lib/nav/storeNav.ts` (منطق خالص). التقسيم بمسافات وفواصل وأوزان خط، مش كروت. القائمة وزرارها من غير
 * `lg` (شكل الكمبيوتر من lg — §٣ و§١٥).
 */
export function MobileMenu({
  collections,
  whatsappHref,
  allLabel,
  social,
  toolsLink = null,
  help,
}: {
  collections: StoreCollection[]
  whatsappHref: string | null
  allLabel: string
  social: SocialLink[]
  /** صفحة «أدوات التركيب» — بس لما تكون مفعّلة وفيه أداة نشطة مربوطة بفيلم نشط. */
  toolsLink?: { href: string; label: string } | null
  /** STORE-MENU §٥ — ظهور «إزاي أطلب» و«الأسئلة المتكررة» (نفس شرط الرئيسية). */
  help: HomeHelpVisibility
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const cart = useCart()
  const titleId = useId()
  const collectionsTitleId = useId()
  const helpTitleId = useId()

  function openMenu() {
    dialogRef.current?.showModal()
    setOpen(true)
  }

  const closingRef = useRef(false)

  /**
   * القفل بحركة: data-closing بيشغّل حركة الخروج في globals.css، وبعد
   * ما تخلص بنقفل الحوار فعلًا. المهلة احتياط لو animationend ماوصلش
   * (تاب في الخلفية مثلًا). مع prefers-reduced-motion القفل فوري.
   */
  function closeMenu() {
    const dialog = dialogRef.current
    if (!dialog || !dialog.open || closingRef.current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dialog.close()
      return
    }

    closingRef.current = true
    dialog.setAttribute('data-closing', '')

    let finished = false
    const onEnd = (event: AnimationEvent) => {
      if (event.target === dialog) finish()
    }
    const finish = () => {
      if (finished) return
      finished = true
      dialog.removeEventListener('animationend', onEnd)
      dialog.removeAttribute('data-closing')
      closingRef.current = false
      dialog.close()
    }

    dialog.addEventListener('animationend', onEnd)
    window.setTimeout(finish, 320)
  }

  // تغيير الصفحة لازم يقفل القائمة — الراوتر مابيعملش unmount للهيدر
  useEffect(() => {
    closeMenu()
  }, [pathname])

  const menu = buildMobileMenu({ pathname, allLabel, collections, toolsLink, help, whatsappHref })
  const badge = cartBadge(cart.ready, cart.itemCount)
  const { cart: cartItem, track: trackItem } = menu.shortcuts
  const hasBrowse = menu.all !== null || menu.collections.length > 0 || menu.tools !== null

  const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
  const rowLink = 'flex min-h-11 items-center rounded-lg px-3 transition-colors hover:bg-border/50 ' + focusRing
  const shortcutLink = 'flex min-h-12 items-center justify-center gap-2 rounded-lg border bg-card px-2 text-sm font-bold transition-colors hover:border-brand/40 ' + focusRing
  const itemStyle = (item: MenuItem) => ({ '--i': item.index }) as CSSProperties
  const currentProps = (item: MenuItem) => (item.current ? { 'aria-current': 'page' as const } : {})

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        aria-label="افتح القائمة"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-transparent text-fg hover:border-border hover:bg-card transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden"
      >
        <Menu className="h-6 w-6" />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        // Escape: نقفل بالحركة بدل القفل الفوري بتاع المتصفح
        onCancel={(event) => {
          event.preventDefault()
          closeMenu()
        }}
        // الضغط على الـbackdrop: الهدف بيكون العنصر نفسه مش أي حاجة جواه
        onClick={(event) => {
          if (event.target === dialogRef.current) closeMenu()
        }}
        className="zell-drawer lg:hidden"
      >
        {/* min-h-0 ضروري: من غيره الـflex child مابيصغرش والscroll مابيشتغلش */}
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-sm font-bold">
              القائمة
            </h2>
            <button
              type="button"
              onClick={closeMenu}
              aria-label="اقفل القائمة"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-fg transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav aria-label="قائمة المتجر" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {/* ١) الاختصارات — السلة والتتبّع جنب بعض، أوضح حاجة في القائمة */}
            <ul className="grid grid-cols-2 gap-2">
              <li className="zell-drawer-item" style={itemStyle(cartItem)}>
                <Link
                  href={cartItem.href}
                  onClick={closeMenu}
                  aria-label={cartLabel(cart.ready, cart.itemCount)}
                  {...currentProps(cartItem)}
                  className={cn(shortcutLink, cartItem.current ? 'border-brand text-brand' : 'border-border text-fg')}
                >
                  <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {cartItem.label}
                  {badge !== null ? (
                    <span
                      aria-hidden="true"
                      className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-brand-fg"
                    >
                      <Num>{badge}</Num>
                    </span>
                  ) : null}
                </Link>
              </li>
              <li className="zell-drawer-item" style={itemStyle(trackItem)}>
                <Link
                  href={trackItem.href}
                  onClick={closeMenu}
                  {...currentProps(trackItem)}
                  className={cn(shortcutLink, trackItem.current ? 'border-brand text-brand' : 'border-border text-fg')}
                >
                  <PackageSearch className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {trackItem.label}
                </Link>
              </li>
            </ul>

            {/* ٢) التصفّح — كل المنتجات أتقل، الأقسام بترتيب اللوحة، الأدوات تحت الأقسام على طول وأخف، من غير فاصل ولا أيقونة (قرار المالك بعد المعاينة — STORE-MENU §١٥) */}
            {hasBrowse ? (
              <div className="mt-4 border-t border-border pt-3">
                {menu.all !== null ? (
                  <ul>
                    <li className="zell-drawer-item" style={itemStyle(menu.all)}>
                      <Link
                        href={menu.all.href}
                        onClick={closeMenu}
                        {...currentProps(menu.all)}
                        className={cn(rowLink, 'text-base font-bold', menu.all.current ? 'text-brand' : 'text-fg')}
                      >
                        {menu.all.label}
                      </Link>
                    </li>
                  </ul>
                ) : null}

                {menu.collections.length > 0 ? (
                  <div className={cn(menu.all !== null && 'mt-2')}>
                    <p id={collectionsTitleId} className="px-3 pb-1 pt-1 text-xs font-semibold text-muted">
                      الأقسام
                    </p>
                    <ul aria-labelledby={collectionsTitleId}>
                      {menu.collections.map((item) => (
                        <li key={item.key} className="zell-drawer-item" style={itemStyle(item)}>
                          <Link
                            href={item.href}
                            onClick={closeMenu}
                            {...currentProps(item)}
                            className={cn(rowLink, 'text-base', item.current ? 'font-bold text-brand' : 'font-normal text-fg')}
                          >
                            {item.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {menu.tools !== null ? (
                  <ul className={cn((menu.all !== null || menu.collections.length > 0) && 'mt-1')}>
                    <li className="zell-drawer-item" style={itemStyle(menu.tools)}>
                      <Link
                        href={menu.tools.href}
                        onClick={closeMenu}
                        {...currentProps(menu.tools)}
                        className={cn(rowLink, 'text-sm', menu.tools.current ? 'font-bold text-brand' : 'font-normal text-muted hover:text-fg')}
                      >
                        {menu.tools.label}
                      </Link>
                    </li>
                  </ul>
                ) : null}
              </div>
            ) : null}

            {/* ٣) المساعدة — بتختفي هي وعنوانها لو مفيش ولا رابط */}
            {menu.showHelp ? (
              <div className="mt-4 border-t border-border pt-3">
                <p id={helpTitleId} className="px-3 pb-1 pt-1 text-xs font-semibold text-muted">
                  المساعدة
                </p>
                <ul aria-labelledby={helpTitleId}>
                  {menu.help.how !== null ? (
                    <li className="zell-drawer-item" style={itemStyle(menu.help.how)}>
                      <Link href={menu.help.how.href} onClick={closeMenu} className={cn(rowLink, 'text-sm font-medium text-fg')}>
                        {menu.help.how.label}
                      </Link>
                    </li>
                  ) : null}
                  {menu.help.faq !== null ? (
                    <li className="zell-drawer-item" style={itemStyle(menu.help.faq)}>
                      <Link href={menu.help.faq.href} onClick={closeMenu} className={cn(rowLink, 'text-sm font-medium text-fg')}>
                        {menu.help.faq.label}
                      </Link>
                    </li>
                  ) : null}
                  {menu.help.whatsapp !== null ? (
                    <li className="zell-drawer-item" style={itemStyle(menu.help.whatsapp)}>
                      <a
                        href={menu.help.whatsapp.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={closeMenu}
                        className={cn(rowLink, 'gap-2 text-sm font-medium text-fg')}
                      >
                        <MessageCircle className="h-4 w-4 shrink-0 text-whatsapp" aria-hidden="true" />
                        {menu.help.whatsapp.label}
                      </a>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </nav>

          {/* ٤) تحت — الرئيسية والسوشيال، سطر واحد هادي (أسماء المنصات لقارئ الشاشة من SocialLinks) */}
          <div className="safe-bottom flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <Link
              href={menu.home.href}
              onClick={closeMenu}
              {...currentProps(menu.home)}
              className={cn(
                'flex min-h-11 items-center rounded-lg px-2 text-sm transition-colors hover:text-accent',
                focusRing,
                menu.home.current ? 'font-bold text-brand' : 'font-medium text-muted',
              )}
            >
              {menu.home.label}
            </Link>
            {social.length > 0 ? <SocialLinks links={social} /> : null}
          </div>
        </div>
      </dialog>
    </>
  )
}
