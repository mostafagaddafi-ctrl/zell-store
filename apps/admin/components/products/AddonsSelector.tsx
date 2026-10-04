'use client'

import Link from 'next/link'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import type { AddonOption } from '../../lib/mutations/productAddons'
import { formatPiastres } from '../../lib/format'
import { Button, buttonClasses } from '../ui/Button'
import { Card, Field, inputClasses } from '../ui/Field'

/**
 * 0016 — الإضافات اللي بتظهر في صفحة الفيلم ده (منتجات قطعة) + عنوان الجزء.
 * العنوان واحد لكل المنتجات (settings.addons_title). بيتحفظ مع «حفظ» تحت.
 */
export function AddonsSelector({
  options,
  value,
  onChange,
  title,
  onTitleChange,
}: {
  options: AddonOption[]
  value: number[]
  onChange: (next: number[]) => void
  title: string
  onTitleChange: (next: string) => void
}) {
  const byId = new Map(options.map((option) => [option.id, option]))
  const available = options.filter((option) => !value.includes(option.id))
  // إضافة مختارة مابقتش منتج بالقطعة (أو اتمسحت من القايمة) — بتظهر «غير متاحة»
  // بزرار شيل، بدل ما تستخبى وتفضل تمنع حفظ الإضافات من غير ما حد يشوفها
  const unavailable = value.filter((id) => !byId.has(id)).length

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    const a = value[index]
    const b = value[target]
    if (a === undefined || b === undefined) return
    const next = [...value]
    next[index] = b
    next[target] = a
    onChange(next)
  }

  return (
    <Card title={'الإضافات (' + String(value.length) + ')'}>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          منتجات بالقطعة (زي أدوات التركيب) بتظهر في صفحة الفيلم ده، والزبون يضيف منها بالعدد. الترتيب هنا هو ترتيب الظهور.
        </p>

        <Field htmlFor="addons-title" label="عنوان الجزء (واحد لكل المنتجات)" hint="مثلًا: أدوات التركيب">
          <input
            id="addons-title"
            value={title}
            maxLength={60}
            onChange={(e) => onTitleChange(e.target.value)}
            className={inputClasses}
            placeholder="أدوات التركيب"
          />
        </Field>

        {options.length === 0 ? (
          <div className="space-y-2 rounded border border-dashed border-border p-3 text-xs text-muted">
            <p>مفيش منتجات بالقطعة لسه.</p>
            <Link href="/products/new?kind=piece" className={buttonClasses('secondary', 'sm')}>
              <Plus className="h-4 w-4" />
              إضافة / منتج بالقطعة
            </Link>
          </div>
        ) : null}

        {unavailable > 0 ? (
          <p className="rounded border border-danger/40 bg-danger/5 px-2.5 py-2 text-xs text-danger">
            {'في ' + String(unavailable) + ' إضافة مابقتش منتج بالقطعة. شيلها من هنا عشان الإضافات تتحفظ.'}
          </p>
        ) : null}

        {value.length > 0 ? (
          <ul className="space-y-1.5">
            {value.map((id, index) => {
              const option = byId.get(id)
              const name = option ? option.nameAr : 'منتج رقم ' + String(id)
              return (
                <li
                  key={id}
                  className={
                    option
                      ? 'flex items-center gap-2 rounded border border-brand/40 bg-brand/5 px-2.5 py-2 text-sm'
                      : 'flex items-center gap-2 rounded border border-danger/40 bg-danger/5 px-2.5 py-2 text-sm'
                  }
                >
                  <span className="min-w-0 flex-1 truncate font-semibold text-fg">{name}</span>
                  {option ? (
                    <span className="shrink-0 text-xs text-muted">{formatPiastres(option.pricePiastres) + ' للقطعة'}</span>
                  ) : (
                    <span className="shrink-0 text-xs font-semibold text-danger">غير متاحة</span>
                  )}
                  {option && !option.isActive ? <span className="shrink-0 text-xs text-danger">متوقّف</span> : null}
                  <Button variant="ghost" size="sm" aria-label="لفوق" disabled={index === 0} onClick={() => move(index, -1)}>
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="لتحت" disabled={index === value.length - 1} onClick={() => move(index, 1)}>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={'شيل ' + name} onClick={() => onChange(value.filter((other) => other !== id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : null}

        {available.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {available.map((option) => (
              <Button key={option.id} variant="secondary" size="sm" disabled={value.length >= 20} onClick={() => onChange([...value, option.id])}>
                <Plus className="h-3.5 w-3.5" />
                {option.nameAr}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
