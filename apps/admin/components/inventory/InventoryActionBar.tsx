'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ActionBarItem = { label: string; value: string; strong?: boolean }

/**
 * شريط الإجماليات والأزرار الثابت لنماذج المخزون.
 *   • الكمبيوتر: sticky تحت منطقة المحتوى.
 *   • الموبايل: ثابت تحت الشاشة بحساب safe-area، والمحرّر بيسيب مسافة تحت المحتوى (max-sm:pb-48).
 *   • z-30 — أقل من الحوارات (z-50) فمابيغطيهاش.
 *   • وانت بتكتب في خانة على الموبايل (الكيبورد مفتوح) الشريط بيستخبى عشان مايغطيش الخانة.
 *   • الأزرار الخطرة (ترحيل / استبعاد) بتفضل بأسماء واضحة ومعاها تأكيد — مش جوه قايمة مبهمة.
 */
export function InventoryActionBar({
  items,
  status,
  children,
}: {
  items: readonly ActionBarItem[]
  status?: ReactNode
  children: ReactNode
}) {
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    const isField = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      target.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select') &&
      target.closest('[data-action-bar]') === null
    const onFocusIn = (event: FocusEvent) => setTyping(isField(event.target))
    const onFocusOut = () => setTyping(false)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return (
    <div
      data-action-bar
      className={cn(
        'sticky bottom-0 z-30 space-y-2 rounded-lg border border-border bg-surface/95 px-4 py-3 shadow-card backdrop-blur',
        'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0',
        'max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
        typing && 'max-sm:hidden',
      )}
    >
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{item.label}</dt>
            <dd className={item.strong ? 'font-bold text-fg' : 'font-semibold text-fg'} dir="ltr">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {status ? <div className="text-xs text-muted">{status}</div> : null}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
