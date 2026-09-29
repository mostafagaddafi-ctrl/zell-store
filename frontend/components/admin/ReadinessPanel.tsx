import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import type { ReadinessCheck } from '../../lib/core/types'
import { Button } from '../../lib/shadcn/button'

type ReadinessPanelProps = {
  checks: ReadinessCheck[]
  readyCount: number
  total: number
  loading: boolean
  onRefresh: () => void
}

/** مؤشر الجاهزية: الإشعارات، الشحن، المنتجات، الصور، واتساب. */
export function ReadinessPanel({ checks, readyCount, total, loading, onRefresh }: ReadinessPanelProps) {
  const allReady = total > 0 && readyCount === total

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {allReady ? (
            <CheckCircle2 className="h-5 w-5 text-success" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-warning" />
          )}
          <h3 className="font-semibold text-card-foreground">
            جاهزية المتجر — {readyCount}/{total}
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`ml-2 h-4 w-4${loading ? ' animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {checks.map((check) => (
          <li
            key={check.key}
            className={`rounded-md border p-3 ${
              check.ok ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5'
            }`}
          >
            <div className="flex items-center gap-2">
              {check.ok ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning" />
              )}
              <span className="text-sm font-medium text-card-foreground">{check.label}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
