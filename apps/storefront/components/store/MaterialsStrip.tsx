import { BadgeCheck, Truck, Wallet } from 'lucide-react'

const ITEMS = [
  { icon: BadgeCheck, title: 'خامات 3M و V-KOOL', note: 'أصلية ومضمونة' },
  { icon: Wallet, title: 'الدفع عند الاستلام', note: 'تدفع لما توصلك' },
  { icon: Truck, title: 'شحن لكل المحافظات', note: 'بسعر معروف قبل الطلب' },
]

export function MaterialsStrip() {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {ITEMS.map((item) => (
        <li key={item.title} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <item.icon className="h-5 w-5 shrink-0 text-brand" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">{item.title}</p>
            <p className="truncate text-xs text-muted">{item.note}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
