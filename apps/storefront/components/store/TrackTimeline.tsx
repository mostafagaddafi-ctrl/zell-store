import { Check } from 'lucide-react'
import { cn } from '../../lib/cn'
import { TRACK_TEXT, trackTime, type TrackStage } from '../../lib/orders/trackView'
import { Num } from './Num'

/**
 * TRACK-ORDER v2 W2-A — خط المراحل (العقد docs/contracts/TRACK-ORDER-v2.md §٤ و§١٧-١، وشكل المالك).
 *
 *   • خط عليه ٥ نقط: المكتملة أخضر بعلامة صح ووقتها، والخط لحدها ملوّن · الحالية مميزة (حلقة + نص «الحالة الحالية») ·
 *     الجاية رمادي. رأسي على الموبايل وأفقي من sm.
 *   • الخط الأخضر بيوصل لمرحلة **مكتملة** بس؛ مرحلة ماحصلتش بتفضل رمادي حتى لو اللي بعدها حصل.
 *   • التمييز بالنص والعلامات (مش اللون بس): علامة صح · «الحالة الحالية» · نص مخفي للقارئ بحالة كل مرحلة.
 */
export function TrackTimeline({ stages }: { stages: TrackStage[] }) {
  return (
    <ol className="flex flex-col sm:flex-row sm:items-start" aria-label="مراحل الطلب">
      {stages.map((stage, index) => {
        const next = stages[index + 1]
        const lineOn = next !== undefined && next.completed
        return (
          <li
            key={stage.key}
            aria-current={stage.state === 'current' ? 'step' : undefined}
            className="relative flex gap-3 pb-6 last:pb-0 sm:flex-1 sm:flex-col sm:items-center sm:gap-2 sm:pb-0 sm:text-center"
          >
            {next !== undefined ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute start-[13px] top-7 bottom-0 w-0.5 sm:start-[calc(50%+14px)] sm:top-[13px] sm:bottom-auto sm:h-0.5 sm:w-[calc(100%-28px)]',
                  lineOn ? 'bg-emerald-600' : 'bg-border',
                )}
              />
            ) : null}
            <StageDot stage={stage} />
            <div className="min-w-0 pt-0.5 sm:pt-0">
              <p className={cn('text-sm', stage.completed || stage.state === 'current' ? 'font-semibold text-fg' : 'text-muted')}>
                {stage.label}
                <span className="sr-only">
                  {' — '}
                  {stage.state === 'current' ? TRACK_TEXT.current : stage.completed ? TRACK_TEXT.done : TRACK_TEXT.upcoming}
                </span>
              </p>
              {stage.state === 'current' ? (
                <p className="text-xs font-semibold text-brand" aria-hidden="true">
                  {TRACK_TEXT.current}
                </p>
              ) : null}
              {stage.at !== null ? (
                <p className="text-xs text-muted">
                  <Num>{trackTime(stage.at)}</Num>
                </p>
              ) : null}
              {stage.caption !== null ? <p className="text-xs text-muted">{stage.caption}</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function StageDot({ stage }: { stage: TrackStage }) {
  if (stage.completed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white',
          stage.state === 'current' ? 'ring-4 ring-emerald-600/25' : null,
        )}
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    )
  }
  if (stage.state === 'current') {
    return (
      <span
        aria-hidden="true"
        className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand bg-card ring-4 ring-brand/15"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-brand" />
      </span>
    )
  }
  return <span aria-hidden="true" className="relative z-10 h-7 w-7 shrink-0 rounded-full border-2 border-border bg-card" />
}
