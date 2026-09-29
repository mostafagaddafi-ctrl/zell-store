import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'whatsapp'
export type ButtonSize = 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-opacity ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-fg hover:opacity-90 active:opacity-80',
  secondary: 'border border-border bg-card text-fg hover:bg-bg',
  ghost: 'text-brand hover:opacity-70',
  whatsapp: 'bg-[#25D366] text-white hover:opacity-90',
}

// أطوال مريحة للإبهام: ٤٤px الحد الأدنى، و٥٦px للأزرار الرئيسية
const SIZES: Record<ButtonSize, string> = {
  md: 'h-11 px-4 text-sm',
  lg: 'h-14 px-5 text-base w-full',
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
