'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, MessageCircle, X } from 'lucide-react'
import type { StoreCollection } from '@zell/core'

/**
 * قائمة الموبايل.
 *
 * ⚠️ مبنية على `<dialog>` + showModal() عن قصد، مش على dropdown متعمول
 *    بالإيد. العنصر الأصلي بيجيب من المتصفح حاجات لو عملناها بإيدينا
 *    كانت هتبقى هشّة:
 *      · حصر التركيز جوه القائمة (focus trap)
 *      · Escape بيقفل
 *      · باقي الصفحة بيبقى inert — مفيش tab بيهرب لورا الحجاب
 *      · طبقة العرض العليا، فمفيش معركة z-index مع الهيدر أو CartBar
 *      · دلالة aria-modal جاهزة
 *    ومفيش أي مكتبة جديدة — والـlockfile مالوش دعوة.
 *
 * ⚠️ الحالة في React **مش** هي مصدر الحقيقة للفتح: المتصفح بيقدر يقفل
 *    الحوار لوحده (Escape). عشان كده بنسمع onClose ونزامن منه، بدل ما
 *    نفترض إن الحالة عندنا دايمًا مطابقة.
 */
export function MobileMenu({
  collections,
  whatsappHref,
}: {
  collections: StoreCollection[]
  whatsappHref: string | null
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const titleId = useId()

  function openMenu() {
    dialogRef.current?.showModal()
    setOpen(true)
  }

  function closeMenu() {
    dialogRef.current?.close()
  }

  // تغيير الصفحة لازم يقفل القائمة — الراوتر مابيعملش unmount للهيدر
  useEffect(() => {
    if (dialogRef.current?.open) dialogRef.current.close()
  }, [pathname])

  const links: { href: string; label: string }[] = [
    { href: '/', label: 'الرئيسية' },
    { href: '/#products', label: 'كل الأفلام' },
    ...collections.map((collection) => ({
      href: '/collection/' + collection.slug,
      label: collection.title,
    })),
  ]

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        aria-label="افتح القائمة"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-fg transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
      >
        <Menu className="h-6 w-6" />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        // الضغط على الحجاب: الهدف بيكون العنصر نفسه مش أي حاجة جواه
        onClick={(event) => {
          if (event.target === dialogRef.current) closeMenu()
        }}
        className="fixed inset-y-0 end-0 m-0 h-dvh w-[86vw] max-w-xs border-s border-border bg-bg p-0 text-fg shadow-card backdrop:bg-fg/50 md:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-sm font-bold">
              القائمة
            </h2>
            <button
              type="button"
              onClick={closeMenu}
              aria-label="اقفل القائمة"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-fg transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={closeMenu}
                    className="block rounded-lg px-3 py-3 text-base font-medium text-fg transition-colors hover:bg-border/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {whatsappHref ? (
            <div className="safe-bottom border-t border-border p-3">
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
