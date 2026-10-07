'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * قسم بيتفتح ويتقفل (اللفّات، المصاريف، خصم المورد). زرار بـ aria-expanded / aria-controls، والمحتوى
 * بيفضل متركّب وهو مقفول (hidden) عشان الخانات ماتفقدش قيمها. forceOpen بيفتحه غصب (مثلًا فيه خطأ).
 */
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = true,
  forceOpen = false,
  children,
}: {
  title: string
  summary?: ReactNode
  defaultOpen?: boolean
  forceOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  const shown = open || forceOpen

  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setOpen(!shown)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start"
      >
        <span className="text-sm font-bold text-fg">{title}</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {summary}
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', shown && 'rotate-180')} />
        </span>
      </button>
      <div id={id} hidden={!shown} className="space-y-3 border-t border-border p-3">
        {children}
      </div>
    </section>
  )
}
