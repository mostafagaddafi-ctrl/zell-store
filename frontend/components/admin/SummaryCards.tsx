import { Banknote, CalendarDays, Inbox, ShoppingBag } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatPiastres } from '../../lib/core/pricing'
import type { OrdersSummary } from '../../lib/core/types'

export function SummaryCards({ summary }: { summary: OrdersSummary | null }) {
  const cards: Array<{ icon: ReactNode; label: string; value: string; hint: string }> = [
    {
      icon: <Inbox className="h-5 w-5" />,
      label: 'طلبات جديدة',
      value: String(summary?.new_count ?? 0),
      hint: 'محتاجة تأكيد',
    },
    {
      icon: <ShoppingBag className="h-5 w-5" />,
      label: 'كل الطلبات',
      value: String(summary?.total_orders ?? 0),
      hint: `${summary?.today_count ?? 0} النهارده`,
    },
    {
      icon: <Banknote className="h-5 w-5" />,
      label: 'المبيعات (بدون الملغي)',
      value: formatPiastres(summary?.sales_piastres ?? 0),
      hint: 'إجمالي كل الفترات',
    },
    {
      icon: <CalendarDays className="h-5 w-5" />,
      label: 'مبيعات الشهر',
      value: formatPiastres(summary?.sales_month_piastres ?? 0),
      hint: 'من أول الشهر الحالي',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            {card.icon}
            <span className="text-sm">{card.label}</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-card-foreground">{card.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{card.hint}</div>
        </div>
      ))}
    </div>
  )
}
