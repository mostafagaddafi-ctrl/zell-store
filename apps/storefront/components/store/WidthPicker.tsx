'use client'

import { useState } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { formatPiastres, type WidthOption } from '@zell/core'
import { Num } from './Num'

/**
 * اختيار عرض الرول — 0015.
 *
 * عرض واحد = مابيظهرش خالص. أكتر من عرض = سطر واحد بالعرض الحالي وسعره +
 * «غيّر العرض» بيفتح الاختيارات، والاختيار بيقفلها تاني — فالصفحة ماتطولش.
 */
export function WidthPicker({
  options,
  value,
  onChange,
}: {
  options: WidthOption[]
  value: number
  onChange: (widthCm: number) => void
}) {
  const [open, setOpen] = useState(false)
  if (options.length < 2) return null
  const current = options.find((option) => option.width_cm === value) ?? options[0]
  if (!current) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">عرض الرول</p>
          <p className="text-base font-bold text-fg">
            <Num>{String(current.width_cm)}</Num> سم ·{' '}
            <Num>{formatPiastres(current.price_per_meter_piastres)}</Num>{' '}
            <span className="text-xs font-medium text-muted">للمتر</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((state) => !state)}
          aria-expanded={open}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-brand/40 px-3 text-sm font-semibold text-brand transition-colors hover:border-brand"
        >
          {open ? 'قفل' : 'غيّر العرض'}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {open ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const active = option.width_cm === current.width_cm
            const compare = option.compare_at_piastres
            return (
              <li key={option.width_cm}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onChange(option.width_cm)
                    setOpen(false)
                  }}
                  className={
                    'flex w-full items-center justify-between gap-2 rounded-lg border-2 px-3 py-3 text-right transition-colors ' +
                    (active ? 'border-brand bg-brand/5' : 'border-border hover:border-brand/50')
                  }
                >
                  <span className="font-bold text-fg">
                    <Num>{String(option.width_cm)}</Num> سم
                  </span>
                  <span className="ms-auto text-sm text-fg">
                    {compare !== null && compare > option.price_per_meter_piastres ? (
                      <span className="me-1.5 text-xs text-muted line-through">
                        <Num>{formatPiastres(compare)}</Num>
                      </span>
                    ) : null}
                    <Num>{formatPiastres(option.price_per_meter_piastres)}</Num>{' '}
                    <span className="text-xs text-muted">للمتر</span>
                  </span>
                  {active ? <Check className="h-4 w-4 shrink-0 text-brand" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
