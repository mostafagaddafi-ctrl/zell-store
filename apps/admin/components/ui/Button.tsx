import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded font-semibold transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-55 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-fg hover:opacity-90',
  secondary: 'border border-border bg-surface text-fg hover:border-muted',
  ghost: 'text-fg hover:bg-border/50',
  danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger/5',
}

// على الموبايل الزراير أعلى شوية — هدف لمس أريح للصباع
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs max-sm:h-9 max-sm:px-3',
  md: 'h-9 px-3 text-sm max-sm:h-10 max-sm:px-3.5',
}

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], extra)
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClasses(variant, size, className)} {...props} />
})
