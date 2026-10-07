'use client'

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { CatalogProduct, SaleUnit } from '../../lib/inventory/catalog'
import { filterProducts, productOptionLabel } from '../../lib/inventory/productSearch'
import { cn } from '../../lib/cn'
import { inputClasses } from '../ui/Field'

/**
 * اختيار المنتج بالبحث — combobox كامل (WAI-ARIA combobox + listbox):
 *   • input بـ role="combobox" و aria-expanded و aria-controls و aria-autocomplete="list"
 *     و aria-activedescendant للخيار النشط.
 *   • الأسهم بتتنقل، Enter بيختار، Escape بيقفل ويرجّع النص، Tab/blur بيقفل.
 *   • الماوس واللمس والقلم (PR-D · مراجعة 3): الاختيار بـ click بس (مرة واحدة لكل ضغطة، وسحب
 *     القايمة للـscroll بيعمل pointercancel فمابيختارش). pointerdown جوه القايمة بيعمل preventDefault
 *     (الفوكس يفضل في الـinput) وبيعلّم pressRef، فالـblur اللي ممكن ييجي قبل الـclick على الموبايل
 *     مابيقفلش القايمة. بعد الـclick أو الـcancel العلامة بتتشال، ولو الفوكس كان خرج القايمة بتتقفل.
 *   • منع التكرار: openRef بيتقفل قبل onChange، فأي click/Enter تاني لنفس الفتحة مابيختارش تاني.
 *   • القايمة متفلترة بوحدة البيع حسب نوع البند، والبحث بالعربي متسامح (normalizeArabicSearch).
 *   • الموقوف بيظهر بـ «(موقوف)».
 */
export function ProductPicker({
  id,
  label,
  products,
  unit,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string
  label: string
  products: readonly CatalogProduct[]
  unit: SaleUnit
  value: string
  onChange: (productId: string) => void
  disabled: boolean
  invalid: boolean
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const options = useMemo(() => filterProducts(products, unit, query), [products, unit, query])
  const selected = products.find((product) => String(product.id) === value)
  const optionId = (index: number) => listId + '-option-' + String(index)
  const inputRef = useRef<HTMLInputElement>(null)
  /** الحالة الفعلية للفتح (متزامنة) — الـstate بيتأخر لحد الـrender الجاي. */
  const openRef = useRef(false)
  /** ضغطة (ماوس/لمس/قلم) بدأت جوه القايمة ولسه ماخلصتش. */
  const pressRef = useRef(false)

  function show() {
    openRef.current = true
    setOpen(true)
  }

  function close() {
    openRef.current = false
    pressRef.current = false
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  function choose(product: CatalogProduct) {
    if (!openRef.current) return
    openRef.current = false
    onChange(String(product.id))
    close()
  }

  /** نهاية ضغطة جوه القايمة من غير اختيار: لو الفوكس خرج من الـinput، اقفل. */
  function endPress() {
    pressRef.current = false
    if (openRef.current && typeof document !== 'undefined' && document.activeElement !== inputRef.current) close()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) show()
      else setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      if (!open) return
      event.preventDefault()
      const option = options[active]
      if (option) choose(option)
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        close()
      }
    }
  }

  const activeOption = open && options[active] ? optionId(active) : undefined

  return (
    <div className="relative space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-fg">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        data-field="product"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption}
        aria-invalid={invalid}
        autoComplete="off"
        placeholder={selected ? undefined : 'اكتب اسم المنتج للبحث'}
        value={open ? query : selected ? productOptionLabel(selected) : ''}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          show()
        }}
        onClick={show}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!pressRef.current) close()
        }}
        className={cn(inputClasses, invalid && 'border-danger')}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        onPointerDown={(event) => {
          pressRef.current = true
          event.preventDefault()
        }}
        onMouseDown={(event) => event.preventDefault()}
        onPointerCancel={endPress}
        onClick={endPress}
        className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded border border-border bg-surface py-1 shadow-pop"
      >
        {options.length === 0 ? (
          <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-2 text-xs text-muted">
            مفيش منتج بالاسم ده
          </li>
        ) : (
          options.map((product, index) => (
            <li
              key={product.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onClick={() => choose(product)}
              onPointerEnter={() => setActive(index)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm text-fg',
                index === active && 'bg-brand/10',
                String(product.id) === value && 'font-bold',
              )}
            >
              {productOptionLabel(product)}
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
