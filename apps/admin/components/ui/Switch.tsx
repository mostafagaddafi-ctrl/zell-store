'use client'

import { cn } from '../../lib/cn'

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        checked ? 'bg-ok' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-all',
          checked ? 'right-0.5' : 'right-4.5',
        )}
        style={{ right: checked ? '0.125rem' : '1.125rem' }}
      />
    </button>
  )
}
