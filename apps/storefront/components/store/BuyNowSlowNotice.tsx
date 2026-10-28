import { Loader2 } from 'lucide-react'
import { BUY_NOW_RETRY_LABEL, BUY_NOW_SLOW_TEXT, type BuyNowPhase } from '../../lib/buy/buyNow'
import { Button } from '../ui/Button'

/**
 * BUY-NOW — تنبيه «التحميل بياخد وقت أطول» بعد 15 ثانية (مش فشل؛ الحماية فاضلة)، وزرار تحميل كامل لصفحة البيانات.
 * برّه الـ fieldset المقفول علشان يفضل قابل للضغط.
 */
export function BuyNowSlowNotice({ phase, onRetry }: { phase: BuyNowPhase; onRetry: () => void }) {
  if (phase !== 'slow' && phase !== 'reloading') return null
  const reloading = phase === 'reloading'
  return (
    <div role="status" aria-live="polite" className="space-y-2 rounded-lg border border-border bg-card p-3 text-center">
      <p className="text-xs font-semibold text-fg">{BUY_NOW_SLOW_TEXT}</p>
      <Button size="md" variant="secondary" onClick={onRetry} disabled={reloading} aria-busy={reloading} className="w-full">
        {reloading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {BUY_NOW_RETRY_LABEL}
      </Button>
    </div>
  )
}
