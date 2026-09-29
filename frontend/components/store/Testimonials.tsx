import { Quote } from 'lucide-react'

export type Testimonial = { name: string; area: string; text: string }

/** آراء عملاء حقيقية — بتظهر بس لما تتضاف من لوحة التحكم. */
export function Testimonials({ items }: { items: Testimonial[] }) {
  if (items.length === 0) return null

  return (
    <section>
      <h2 className="text-base font-bold text-foreground">ناس ركّبت من ZELL</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item, index) => (
          <blockquote key={`${item.name}-${index}`} className="rounded-2xl border border-border bg-card p-4">
            <Quote className="h-4 w-4 text-primary" />
            <p className="mt-2 text-sm leading-6 text-card-foreground">{item.text}</p>
            <footer className="mt-2 text-xs text-muted-foreground">
              {item.name}
              {item.area ? ` — ${item.area}` : ''}
            </footer>
          </blockquote>
        ))}
      </div>
    </section>
  )
}
