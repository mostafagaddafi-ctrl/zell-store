import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-border/60 text-fg',
  info: 'bg-brand/10 text-brand',
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-gold/15 text-fg',
  danger: 'bg-danger/10 text-danger',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>
      {children}
    </span>
  )
}
