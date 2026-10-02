import { Plus } from 'lucide-react'
import type { StoreContent } from '@zell/core'

/** الأسئلة المتكررة من «المحتوى» في اللوحة. */
export function Faq({ items }: { items: StoreContent['faqs'] }) {
  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item, index) => (
        <details key={String(index) + item.question} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold text-fg">
            {item.question}
            <Plus className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-45" />
          </summary>
          <p className="max-w-2xl whitespace-pre-line pb-4 text-sm leading-relaxed text-muted">{item.answer}</p>
        </details>
      ))}
    </div>
  )
}
