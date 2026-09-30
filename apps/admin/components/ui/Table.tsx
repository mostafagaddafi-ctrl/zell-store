import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-surface', className)}>
      <table className="w-full min-w-[42rem] border-collapse text-right text-sm">{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-border bg-bg/60">{children}</thead>
}

export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2 text-xs font-semibold text-muted', className)}>{children}</th>
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn('border-b border-border last:border-0', className)}>{children}</tr>
}

export function TD({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2.5 align-middle text-fg', className)}>{children}</td>
}
