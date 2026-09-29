import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * text-base (١٦px) مقصود: أي حجم أقل بيخلي iOS يعمل zoom تلقائي عند التركيز
 * على الحقل، وده أسوأ عيب في فورمات الموبايل.
 */
export const inputClasses =
  'w-full h-12 rounded-xl border border-border bg-card px-3 text-base text-fg ' +
  'placeholder:text-muted outline-none transition-colors ' +
  'focus:border-brand focus:ring-2 focus:ring-brand/25'

export const textareaClasses =
  'w-full min-h-24 rounded-xl border border-border bg-card p-3 text-base text-fg ' +
  'placeholder:text-muted outline-none transition-colors resize-y ' +
  'focus:border-brand focus:ring-2 focus:ring-brand/25'

export function Field({
  htmlFor,
  label,
  error,
  hint,
  children,
  className,
}: {
  htmlFor: string
  label: string
  error?: string | undefined
  hint?: string | undefined
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-fg">
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
