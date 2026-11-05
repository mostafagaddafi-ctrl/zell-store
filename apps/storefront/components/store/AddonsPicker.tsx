'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Minus, Plus, Wrench } from 'lucide-react'
import { discountInfo, formatPiastres, maxQuantityOf, primaryImage, type StoreProduct } from '@zell/core'
import { buttonClasses } from '../ui/Button'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'
import { ProductQuickView } from './ProductQuickView'
import { quickViewOf } from '../../lib/quickView'

/**
 * الإضافات (0016) — منتجات قطعة بتتضاف مع الفيلم، بنفس روح كارت الهدية.
 *
 * العنوان من «عنوان جزء الإضافات» في اللوحة. كل إضافة: صورة · اسم · سعر
 * القطعة · عدد. السعر هنا للعرض بس — zell_create_order بتسعّر من الداتابيز.
 *
 * «أضف الكل» زرار واضح في أول الكارت (اللي هيركّب بنفسه غالبًا محتاج الأدوات كلها): بيحط كل الأدوات بعدد 1
 * (أو العدد المختار لو أكتر) — بنفس الأسعار ومن غير أي خصم، ومن غير إضافة تلقائية من غير ضغطة. اسم الأداة
 * وصورتها بيفتحوا تفاصيلها في نافذة فوق نفس الصفحة (ProductQuickView — قرار المالك 2026-11-05)، فيها نفس
 * العدّاد وزرار X للقفل، علشان اختيارات صفحة الفيلم ماتضيعش والزبون مايسيبش الصفحة.
 */
export function AddonsPicker({
  addons,
  title,
  quantities,
  onChange,
  defaultOpen = false,
}: {
  addons: StoreProduct[]
  title: string
  quantities: Record<number, number>
  onChange: (next: Record<number, number>) => void
  /** مفتوحة من الأول — لما العميل يرجع لـ«هركّبه بنفسي». */
  defaultOpen?: boolean
}) {
  // مقفولة الأول: الزبون اللي محتاج أدوات بيفتحها ويختار — الباقي مابتطوّلش الصفحة عليه
  const [open, setOpen] = useState(defaultOpen)
  // عقد defaultOpen: انتقاله false → true (أول mount أو بعده) بيفتح المنتقي مرة واحدة.
  // رجوعه false مابيقفلش، وأي render عادي مابيعيدش الفتح — القفل اليدوي بيفضل زي ما هو.
  const lastDefaultOpen = useRef(defaultOpen)
  useEffect(() => {
    if (defaultOpen && !lastDefaultOpen.current) setOpen(true)
    lastDefaultOpen.current = defaultOpen
  }, [defaultOpen])
  // الأداة المفتوحة في النافذة (null = مقفولة)
  const [viewId, setViewId] = useState<number | null>(null)
  if (addons.length === 0) return null

  const qty = (id: number) => quantities[id] ?? 0
  const set = (id: number, next: number) => onChange({ ...quantities, [id]: next })
  const total = addons.reduce((sum, addon) => sum + addon.price_per_meter_piastres * qty(addon.id), 0)
  const allPicked = addons.every((addon) => qty(addon.id) > 0)
  const allPrice = addons.reduce((sum, addon) => sum + addon.price_per_meter_piastres * Math.max(1, qty(addon.id)), 0)
  const pickAll = () => onChange(Object.fromEntries(addons.map((addon) => [addon.id, Math.max(1, qty(addon.id))])))
  const pickedCount = addons.filter((addon) => qty(addon.id) > 0).length

  // عدّاد الإضافة — نفسه في الصف وفي النافذة: نفس set ونفس الحد، مفيش منطق جديد
  const controlsFor = (addon: StoreProduct) => {
    const quantity = qty(addon.id)
    const max = maxQuantityOf(addon)
    return quantity === 0 ? (
      <button
        type="button"
        onClick={() => set(addon.id, 1)}
        className="h-10 shrink-0 rounded-lg border border-brand/40 px-4 text-sm font-semibold text-brand transition-colors hover:border-brand"
      >
        ضيف
      </button>
    ) : (
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={'قلّل ' + addon.name_ar}
          onClick={() => set(addon.id, quantity - 1)}
          className="grid h-9 w-9 place-items-center rounded-lg border border-border text-fg transition-colors hover:border-muted"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-7 text-center text-sm font-bold text-fg">
          <Num>{String(quantity)}</Num>
        </span>
        <button
          type="button"
          aria-label={'زوّد ' + addon.name_ar}
          disabled={quantity >= max}
          onClick={() => set(addon.id, quantity + 1)}
          className="grid h-9 w-9 place-items-center rounded-lg border border-border text-fg transition-colors hover:border-muted disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    )
  }
  const viewed = viewId === null ? undefined : addons.find((addon) => addon.id === viewId)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        aria-expanded={open}
        className={'flex w-full items-center gap-3 px-4 py-3 text-right ' + (open ? 'border-b border-border' : '')}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg text-brand">
          <Wrench className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-fg">{title}</span>
          <span className="block text-xs text-muted">
            {pickedCount > 0 ? (
              <>
                <Num>{String(pickedCount)}</Num> {pickedCount === 1 ? 'إضافة' : 'إضافات'} · <Num>{formatPiastres(total)}</Num>
              </>
            ) : (
              'محتاجها؟ دوس واختار اللي ناقصك — أو أضفهم كلهم مرة واحدة'
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand">
          {open ? 'قفل' : pickedCount > 0 ? 'تعديل' : 'اختار'}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open ? (
        <>
      {addons.length > 1 ? (
        <div className="border-b border-border px-4 py-3">
          {allPicked ? (
            <p role="status" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-brand">
              <Check className="h-4 w-4" aria-hidden="true" />
              اتضافوا كلهم
            </p>
          ) : (
            <button type="button" onClick={pickAll} className={buttonClasses('primary', 'md', 'w-full')}>
              أضف الكل ({addons.length === 2 ? 'أداتين' : <><Num>{String(addons.length)}</Num> {addons.length <= 10 ? 'أدوات' : 'أداة'}</>}) ·{' '}
              <Num>{formatPiastres(allPrice)}</Num>
            </button>
          )}
        </div>
      ) : null}
      <ul className="divide-y divide-border">
        {addons.map((addon) => {
          const image = primaryImage(addon)
          const discount = discountInfo(addon)
          return (
            <li key={addon.id} className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => setViewId(addon.id)}
                aria-haspopup="dialog"
                aria-label={'تفاصيل ' + addon.name_ar}
                className="shrink-0 rounded-lg"
              >
                <ImageSlot
                  ratio="1/1"
                  fit="cover"
                  src={image?.url ?? null}
                  alt={image?.alt ?? addon.name_ar}
                  sizes="56px"
                  className="h-14 w-14 shrink-0 rounded-lg border border-border"
                />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">
                  <button type="button" onClick={() => setViewId(addon.id)} aria-haspopup="dialog" className="max-w-full truncate text-right hover:underline">
                    {addon.name_ar}
                  </button>
                </p>
                <p className="text-xs text-muted">
                  {discount ? (
                    <span className="me-1 line-through">
                      <Num>{formatPiastres(discount.compareAtPiastres)}</Num>
                    </span>
                  ) : null}
                  <span className="font-semibold text-fg">
                    <Num>{formatPiastres(addon.price_per_meter_piastres)}</Num>
                  </span>{' '}
                  للوحدة
                </p>
              </div>
              {controlsFor(addon)}
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-bg/60 px-4 py-3">
        {total > 0 ? (
          <p className="text-sm text-fg">
            الإضافات:{' '}
            <span className="font-bold">
              <Num>{formatPiastres(total)}</Num>
            </span>
          </p>
        ) : (
          <span className="text-xs text-muted">مفيش إضافات مختارة</span>
        )}
      </div>
        </>
      ) : null}

      <ProductQuickView view={viewed ? quickViewOf(viewed) : null} onClose={() => setViewId(null)}>
        {viewed ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">{qty(viewed.id) > 0 ? 'مضافة مع الفيلم' : 'ضيفها مع الفيلم'}</span>
            {controlsFor(viewed)}
          </div>
        ) : null}
      </ProductQuickView>
    </div>
  )
}
