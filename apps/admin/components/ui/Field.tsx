import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * ⚠️ max-sm:text-base مش تزيين: Safari على الآيفون بيعمل zoom تلقائي لأي
 *    خانة خطها أقل من 16px. وعلى الموبايل الخانة أعلى شوية للصباع.
 */
export const inputClasses =
  'w-full h-9 rounded border border-border bg-surface px-2.5 text-sm text-fg max-sm:h-10 max-sm:text-base ' +
  'placeholder:text-muted outline-none transition-colors ' +
  'focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-bg disabled:text-muted'

export const textareaClasses =
  'w-full min-h-20 rounded border border-border bg-surface p-2.5 text-sm text-fg max-sm:text-base ' +
  'placeholder:text-muted outline-none transition-colors resize-y ' +
  'focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-bg disabled:text-muted'

export function Field({
  htmlFor,
  label,
  hint,
  error,
  children,
  className,
}: {
  htmlFor?: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-lg border border-border bg-surface shadow-card', className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {title ? <h2 className="text-sm font-bold text-fg">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}
