'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { formatPiastres } from '@zell/core'
import type { QuickView } from '../../lib/quickView'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'

/**
 * نافذة المنتج السريعة (بوب أب) — قرار المالك 2026-11-05.
 *
 * الضغط على اسم أداة أو صورتها (كارت الإضافات في صفحة الفيلم · صفحة «أدوات التركيب») بيفتح تفاصيلها
 * فوق نفس الصفحة بدل ما ينقل لصفحة تانية، علشان اختيارات الزبون ماتضيعش ومايحتاجش يرجع.
 * القفل: زرار X فوق · Escape · الضغط برا النافذة.
 *
 * ⚠️ مبنية على dialog + showModal() زي MobileMenu: حصر التركيز، Escape، inert للخلفية،
 *    والطبقة العليا (مفيش معركة z-index) — كلها من المتصفح. مفيش مكتبة جديدة.
 * ⚠️ الموضع والمقاس في «.zell-sheet» في globals.css (نفس سبب «.zell-drawer»): على الموبايل
 *    لوحة من تحت، ومن sm نافذة في النص.
 * ⚠️ الحالة في React (view) هي اللي بتفتح وتقفل؛ المتصفح بيقفل لوحده بـ Escape، فبنسمع onClose ونبلّغ الأب.
 * ⚠️ عرض بس: children (تحت) هو نفس عدّاد الصف في الصفحة — مفيش منطق سلة ولا تسعير جديد هنا.
 */
export function ProductQuickView({
  view,
  onClose,
  children,
}: {
  view: QuickView | null
  onClose: () => void
  children?: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const isOpen = view !== null

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isOpen && !dialog.open) dialog.showModal()
    if (!isOpen && dialog.open) dialog.close()
  }, [isOpen])

  const close = () => dialogRef.current?.close()

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      // الضغط على الخلفية: الهدف بيكون الـ dialog نفسه مش أي حاجة جواه
      onClick={(event) => {
        if (event.target === dialogRef.current) close()
      }}
      className="zell-sheet"
    >
      {view ? (
        <>
          <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-extrabold leading-6 text-fg">
                {view.name}
              </h2>
              {view.nameEn !== '' ? <p className="text-xs text-muted">{view.nameEn}</p> : null}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="اقفل"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-fg transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
            {view.images.length > 0 ? (
              <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4">
                {view.images.map((image, index) => (
                  <div
                    key={image.url + '-' + String(index)}
                    className={(view.images.length > 1 ? 'w-[82%]' : 'w-full') + ' shrink-0 snap-center'}
                  >
                    <ImageSlot
                      ratio="1/1"
                      fit="contain"
                      src={image.url}
                      alt={image.alt}
                      sizes="(min-width: 640px) 28rem, 90vw"
                      className="w-full rounded-lg border border-border"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <div>
              <span className="text-xl font-extrabold text-fg">
                <Num>{formatPiastres(view.pricePiastres)}</Num>
              </span>
              {view.compareAtPiastres !== null ? (
                <span className="ms-2 text-sm text-muted line-through">
                  <Num>{formatPiastres(view.compareAtPiastres)}</Num>
                </span>
              ) : null}
              <span className="ms-2 text-sm text-muted">للوحدة</span>
              {view.discountPercent !== null ? (
                <span className="ms-2 inline-flex items-center rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-brand-fg">
                  خصم <Num>{String(view.discountPercent)}</Num>٪
                </span>
              ) : null}
            </div>

            {view.description !== '' ? (
              <p className="text-sm leading-relaxed text-muted">{view.description}</p>
            ) : null}

            {view.points.length > 0 ? (
              <ul className="space-y-2">
                {view.points.map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm text-fg">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {children ? <div className="shrink-0 border-t border-border bg-bg/60 px-4 py-3">{children}</div> : null}
        </>
      ) : null}
    </dialog>
  )
}
