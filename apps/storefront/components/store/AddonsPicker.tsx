'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Minus, Plus, Wrench } from 'lucide-react'
import { discountInfo, formatPiastres, maxQuantityOf, primaryImage, type StoreProduct } from '@zell/core'
import { ImageSlot } from '../ui/ImageSlot'
import { Num } from './Num'

/**
 * الإضافات (0016) — منتجات قطعة بتتضاف مع الفيلم، بنفس روح كارت الهدية.
 *
 * العنوان من «عنوان جزء الإضافات» في اللوحة. كل إضافة: صورة · اسم · سعر
 * القطعة · عدد. السعر هنا للعرض بس — zell_create_order بتسعّر من الداتابيز.
 */
export function AddonsPicker({
  addons,
  title,
  quantities,
  onChange,
}: {
  addons: StoreProduct[]
  title: string
  quantities: Record<number, number>
  onChange: (next: Record<number, number>) => void
}) {
  // مقفولة الأول: الزبون اللي محتاج أدوات بيفتحها ويختار — الباقي مابتطوّلش الصفحة عليه
  const [open, setOpen] = useState(false)
  if (addons.length === 0) return null

  const qty = (id: number) => quantities[id] ?? 0
  const set = (id: number, next: number) => onChange({ ...quantities, [id]: next })
  const total = addons.reduce((sum, addon) => sum + addon.price_per_meter_piastres * qty(addon.id), 0)
  const allPicked = addons.every((addon) => qty(addon.id) > 0)
  const allPrice = addons.reduce((sum, addon) => sum + addon.price_per_meter_piastres * Math.max(1, qty(addon.id)), 0)
  const pickAll = () => onChange(Object.fromEntries(addons.map((addon) => [addon.id, Math.max(1, qty(addon.id))])))
  const pickedCount = addons.filter((addon) => qty(addon.id) > 0).length

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
              'محتاجها؟ دوس واختار اللي ناقصك — أو خد الباكدج كاملة'
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
      <ul className="divide-y divide-border">
        {addons.map((addon) => {
          const quantity = qty(addon.id)
          const max = maxQuantityOf(addon)
          const image = primaryImage(addon)
          const discount = discountInfo(addon)
          return (
            <li key={addon.id} className="flex items-center gap-3 px-4 py-3">
              <ImageSlot
                ratio="1/1"
                fit="cover"
                src={image?.url ?? null}
                alt={image?.alt ?? addon.name_ar}
                sizes="56px"
                className="h-14 w-14 shrink-0 rounded-lg border border-border"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{addon.name_ar}</p>
                <p className="text-xs text-muted">
                  {discount ? (
                    <span className="me-1 line-through">
                      <Num>{formatPiastres(discount.compareAtPiastres)}</Num>
                    </span>
                  ) : null}
                  <span className="font-semibold text-fg">
                    <Num>{formatPiastres(addon.price_per_meter_piastres)}</Num>
                  </span>{' '}
                  للقطعة
                </p>
              </div>
              {quantity === 0 ? (
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
              )}
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
        {!allPicked && addons.length > 1 ? (
          <button
            type="button"
            onClick={pickAll}
            className="h-10 rounded-lg bg-brand/10 px-3 text-sm font-semibold text-brand transition-colors hover:bg-brand/15"
          >
            خد الكل · <Num>{formatPiastres(allPrice)}</Num>
          </button>
        ) : null}
      </div>
        </>
      ) : null}
    </div>
  )
}
