import { Gift } from 'lucide-react'

/**
 * «هدية مع طلبك» — في صفحة المنتج جنب زرار الإضافة للسلة.
 *
 * الهدية بتتقال في لحظة القرار (المقاس والسعر قدام الزبون)، مش في شريط
 * فوق ممكن مايتبصّش عليه. النص من «نص العرض» في الهوية، ومفتاح الإظهار
 * هناك برضه. نص فاضي = مفيش كارت.
 */
export function GiftNote({ text }: { text: string }) {
  if (text.trim() === '') return null

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-brand shadow-card">
        <Gift className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted">هدية مع طلبك</p>
        <p className="text-sm font-bold text-fg">{text}</p>
      </div>
    </div>
  )
}
