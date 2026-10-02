'use client'

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, MessageCircle, ShoppingBag, X } from 'lucide-react'
import type { StoreCollection } from '@zell/core'

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
 */
export function MobileMenu({
  collections,
  whatsappHref,
  allLabel,
}: {
  collections: StoreCollection[]
  whatsappHref: string | null
  allLabel: string
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const titleId = useId()

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

  /**
   * الروابط الثابتة أول حاجة.
   *
   * ⚠️ النسخة الأولى كانت رابطين بس (الرئيسية + كل الأفلام) لأن
   *    المجموعات لسه فاضية — فالقائمة كانت تبان «ناقصة» بمعنى المحتوى
   *    كمان، مش القص بس. الروابط الثابتة دي موجودة دايمًا.
   */
  const links: { href: string; label: string }[] = [
    { href: '/', label: 'الرئيسية' },
    ...(allLabel ? [{ href: '/products', label: allLabel }] : []),
    ...collections.map((collection) => ({
      href: '/collection/' + collection.slug,
      label: collection.title,
    })),
    { href: '/#how', label: 'إزاي أطلب' },
    { href: '/#faq', label: 'أسئلة متكررة' },
  ]

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        aria-label="افتح القائمة"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-transparent text-fg hover:border-border hover:bg-card transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
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
        className="zell-drawer md:hidden"
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

          <nav aria-label="قائمة المتجر" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            <ul className="space-y-1">
              {links.map((link, index) => (
                <li key={link.href} className="zell-drawer-item" style={{ '--i': index } as CSSProperties}>
                  <Link
                    href={link.href}
                    onClick={closeMenu}
                    className="block rounded-lg border border-transparent px-3 py-3 text-base font-semibold text-fg hover:border-border hover:bg-card transition-colors hover:bg-border/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}

              <li className="pt-1">
                <Link
                  href="/cart"
                  onClick={closeMenu}
                  className="flex items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-fg transition-colors hover:bg-border/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <ShoppingBag className="h-5 w-5" />
                  السلة
                </Link>
              </li>
            </ul>
          </nav>

          {whatsappHref ? (
            <div className="safe-bottom shrink-0 border-t border-border p-3">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeMenu}
                className="flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white"
              >
                <MessageCircle className="h-5 w-5" />
                استفسر على واتساب
              </a>
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  )
}
